import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { loadSettings, writeSettings, hasSession, setSession, clearSession } from './settings'
import { fetchLeagues } from './leagues'
import { HOTKEY_SCOPE, type HotkeyId, type HotkeyResult, type MarketQuery, type OverlayEvent, type Settings } from '../shared/types'
import { parseItem } from '../shared/poe1/item'
import { copyItemText } from './poe1/copy'
import { priceCheck } from './poe1/pricecheck'
import { getCached, scan } from './poe1/market'
import { getRates } from './poe1/ninja'
import { limits } from './poe1/trade'

let win: BrowserWindow | null = null
let settings: Settings

if (!app.requestSingleInstanceLock()) app.quit()

function send(e: OverlayEvent) {
  win?.webContents.send('overlay:event', e)
}

function showOverlay() {
  if (!win) return
  win.show()
  win.focus()
}

function toggleOverlay() {
  if (!win) return
  if (win.isVisible()) win.hide()
  else showOverlay()
}

function applyClickThrough() {
  win?.setIgnoreMouseEvents(settings.clickThrough, { forward: true })
  send({ type: 'clickThrough', value: settings.clickThrough })
}

/** Лига для запросов: выбранная в настройках или текущая Softcore. */
async function currentLeague(): Promise<string> {
  if (settings.league) return settings.league
  const info = await fetchLeagues()
  return info.currentSoftcore ?? 'Standard'
}

function sendLimits() {
  send({ type: 'limits', data: limits() })
}

/** Ctrl+C в игре → разбор предмета → (для оценки) поиск похожих на трейде. */
async function readItem(mode: 'read' | 'price') {
  // если в фокусе сам оверлей, Ctrl+C ушёл бы ему, а не игре
  const text = win?.isFocused() ? null : await copyItemText()
  const item = text ? parseItem(text) : null
  if (win && !win.isVisible()) win.showInactive() // не забираем фокус у игры
  send({ type: 'item', item, mode })
  send({ type: 'hotkey', id: mode })
  if (mode !== 'price' || !item) return
  send({ type: 'priceCheck', data: { item, criteria: [], result: null, loading: true } })
  const data = await priceCheck(await currentLeague(), item, settings)
  send({ type: 'priceCheck', data })
  sendLimits()
}

const actions: Record<HotkeyId, () => void> = {
  toggle: toggleOverlay,
  read: () => void readItem('read'),
  price: () => void readItem('price'),
  click: () => {
    settings = { ...settings, clickThrough: !settings.clickThrough }
    writeSettings(settings)
    applyClickThrough()
  },
  step: () => send({ type: 'hotkey', id: 'step' }),
  tab: () => send({ type: 'hotkey', id: 'tab' })
}

/** Регистрирует только глобальные сочетания; локальные обрабатывает окно оверлея. */
function registerHotkeys(): HotkeyResult {
  globalShortcut.unregisterAll()
  const failed: HotkeyId[] = []
  for (const [id, acc] of Object.entries(settings.hotkeys) as [HotkeyId, string][]) {
    if (!acc || HOTKEY_SCOPE[id] !== 'global') continue
    try {
      if (!globalShortcut.register(acc, actions[id])) failed.push(id)
    } catch {
      failed.push(id)
    }
  }
  return { failed }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  const w = settings.window
  const width = w.width ?? 460
  const height = w.height ?? Math.min(720, workArea.height - 80)
  win = new BrowserWindow({
    x: w.x ?? workArea.x + workArea.width - width - 24,
    y: w.y ?? workArea.y + 40,
    width,
    height,
    minWidth: 380,
    minHeight: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  const saveBounds = () => {
    if (!win) return
    const b = win.getBounds()
    settings = { ...settings, window: { x: b.x, y: b.y, width: b.width, height: b.height } }
    writeSettings(settings)
  }
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => {
    applyClickThrough()
    showOverlay()
  })

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
  settings = { ...settings, ...patch, hotkeys: { ...settings.hotkeys, ...(patch.hotkeys ?? {}) } }
  writeSettings(settings)
  if (patch.clickThrough !== undefined) applyClickThrough()
  return { settings, hotkeys: registerHotkeys() }
})
ipcMain.handle('leagues:get', () => fetchLeagues())
ipcMain.handle('session:has', () => hasSession())
ipcMain.handle('session:set', (_e, v: string) => setSession(v))
ipcMain.handle('session:clear', () => clearSession())
// пока пользователь назначает новое сочетание, глобальные клавиши не должны срабатывать
ipcMain.handle('hotkeys:suspend', (_e, suspend: boolean) => {
  if (suspend) globalShortcut.unregisterAll()
  else registerHotkeys()
})
ipcMain.on('overlay:hide', () => win?.hide())

// Рынок: трейд опрашивается только по явной команде пользователя («Найти» / «Загрузить ещё»)
ipcMain.handle('market:get', async (_e, q: MarketQuery) => getCached(await currentLeague(), q))
ipcMain.handle('market:scan', async (_e, q: MarketQuery, more: boolean) => {
  const league = await currentLeague()
  const timer = setInterval(sendLimits, 1000)
  try {
    await scan(league, q, more, settings, (data) => send({ type: 'market', data }))
  } catch (e) {
    const cached = await getCached(league, q)
    send({ type: 'market', data: { ...cached, scanning: false, error: e instanceof Error ? e.message : String(e) } })
  } finally {
    clearInterval(timer)
    sendLimits()
  }
})
ipcMain.handle('rates:divine', async () => {
  try {
    return (await getRates(await currentLeague())).divine
  } catch {
    return null
  }
})
ipcMain.handle('limits:get', () => limits())

app.on('second-instance', showOverlay)
app.whenReady().then(() => {
  settings = loadSettings()
  createWindow()
  registerHotkeys()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
