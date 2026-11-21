import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { loadSettings, writeSettings, hasSession, setSession, clearSession } from './settings'
import { fetchLeagues } from './leagues'
import {
  HOTKEY_SCOPE, type HotkeyId, type HotkeyResult, type Lang, type MarketQuery, type OverlayEvent, type ParsedItem, type PcFilter,
  type PriceCheckState, type Settings, type SlotId, type DiscoveredCombo, type ValueEstimate, type JournalEntry, type CraftPlanOptions
} from '../shared/types'
import { parseItem } from '../shared/poe1/item'
import { copyItemText } from './poe1/copy'
import { defaultFilters, pcMore, pcSearch } from './poe1/pricecheck'
import { buildPlan } from './poe1/planner'
import { basePrice } from './poe1/baseprice'
import { harvestFile, resetHarvest } from './poe1/harvest'
import { craftStatus, onCraftStatus } from './poe1/craftdata'
import { currencyIcons } from './poe1/icons'
import { getCached, scan } from './poe1/market'
import { getRates } from './poe1/ninja'
import { limits } from './poe1/trade'
import { gameClientRect, hwndOf, isGameTitle, visibleTitleAt } from './poe1/focus'
import { addFromPriceCheck, removeCustom } from './poe1/customprofiles'
import { addJournal, listJournal, removeJournal, updateJournal } from './journal'
import { checkNow, startWatcher, type WatcherDeps } from './watcher'
import { appIcon, createTray } from './tray'
import { exchangeData, exchangeIcons } from './poe1/exchange'
import { mapMods } from './poe1/mapmods'
import { itemBases, itemMods } from './poe1/itemmods'
import { addableFor } from './poe1/addable'
import { oppState, scanNow, startOpportunities, type OppDeps } from './opportunities'
import { withBaseType } from './poe1/modinfo'
import { precraftVariants } from './poe1/precraft'
import { discoverCombos, saveCombo } from './poe1/discover'
import { closeStash, debugStash, stashVisible, stashWindow, toggleStash } from './stash'
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate, updateState } from './updater'

let win: BrowserWindow | null = null
let settings: Settings

migrateUserData()
if (!app.requestSingleInstanceLock()) app.quit()

/**
 * Приложение переименовано из «Exile Forge» в «PoESmith», а с ним сменилась папка %APPDATA%.
 * При первом запуске переносим настройки, кэш, журнал и данные игры из старой папки (сама она остаётся).
 */
function migrateUserData() {
  try {
    const next = app.getPath('userData')
    const old = join(app.getPath('appData'), 'Exile Forge')
    if (existsSync(join(next, 'settings.json')) || !existsSync(join(old, 'settings.json'))) return
    mkdirSync(next, { recursive: true })
    for (const name of ['settings.json', 'market-cache.json', 'trade-stats.json', 'harvest-costs.json', 'custom-profiles.json', 'journal.json', 'repoe', 'currency-icons'])
      if (existsSync(join(old, name))) cpSync(join(old, name), join(next, name), { recursive: true })
  } catch {
    /* не удалось — начнём с чистых настроек */
  }
}

function send(e: OverlayEvent) {
  win?.webContents.send('overlay:event', e)
}

/** что хочет пользователь (горячая клавиша / крестик); фактический показ ещё зависит от активного окна */
let userVisible = true
let pcVisible = false

function showOverlay() {
  if (!win) return
  userVisible = true
  win.show()
  win.focus()
}

/** Скрыть оверлей вместе с окном прайс-чека. */
function hideAll() {
  userVisible = false
  pcVisible = false
  win?.hide()
  if (pcWin && !pcWin.isDestroyed()) pcWin.hide()
}

function toggleOverlay() {
  if (!win) return
  if (win.isVisible()) hideAll()
  else showOverlay()
}

/** «Показывать только когда игра активна»: прячем окна, когда активно что-то кроме игры и самого оверлея. */
function watchFocus() {
  setInterval(() => {
    if (!settings.onlyWhenGameFocused || !win) return
    const ours = win.isFocused() || !!pcWin?.isFocused()
    // что видно на мониторе оверлея: игра — показываем; другое приложение поверх игры — прячем
    // (клик по окну на другом мониторе оверлей не прячет, пока на его мониторе по-прежнему игра)
    let game = ours
    if (!ours) {
      try {
        const disp = screen.getDisplayMatching(win.getBounds())
        const c = screen.dipToScreenPoint({ x: disp.bounds.x + disp.bounds.width / 2, y: disp.bounds.y + disp.bounds.height / 2 })
        const mine = [win, pcWin].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map((w) => hwndOf(w.getNativeWindowHandle()))
        const t = visibleTitleAt(Math.round(c.x), Math.round(c.y), mine)
        game = t != null && isGameTitle(t)
      } catch {
        game = true
      }
    }
    // оверлей склада: проверяем, что видно в центре окна игры (игра может быть на другом мониторе, чем основное окно)
    if (stashVisible()) {
      try {
        const r = gameClientRect()
        const sw = stashWindow()
        const mine = [win, pcWin, sw].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()).map((w) => hwndOf(w.getNativeWindowHandle()))
        const t = r ? visibleTitleAt(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), mine) : null
        if (!t || !isGameTitle(t)) closeStash()
      } catch {
        /* не удалось проверить — оставляем как есть */
      }
    }
    for (const [w, wanted] of [[win, userVisible], [pcWin, pcVisible]] as const) {
      if (!w || w.isDestroyed()) continue
      if (wanted && game && !w.isVisible()) w.showInactive()
      else if ((!wanted || !game) && w.isVisible()) w.hide()
    }
  }, 400)
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

// ---------- окно прайс-чека: слева от основного ----------
let pcWin: BrowserWindow | null = null
let pcState: PriceCheckState | null = null

function rendererUrl(win: BrowserWindow, hash = '') {
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'] + hash)
  else win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash: hash.slice(1) } : undefined)
}

function showPriceCheck() {
  const main = win?.getBounds()
  const width = 400
  const { workArea } = screen.getPrimaryDisplay()
  const x = main ? Math.max(workArea.x, main.x - width - 8) : workArea.x + 24
  const y = main?.y ?? workArea.y + 40
  const height = main?.height ?? 720
  pcVisible = true
  if (!pcWin || pcWin.isDestroyed()) {
    pcWin = new BrowserWindow({
      x, y, width, height, minWidth: 340, minHeight: 300, frame: false, transparent: true, backgroundColor: '#00000000', icon: appIcon(),
      resizable: true, skipTaskbar: true, alwaysOnTop: true, show: false,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
    })
    pcWin.setAlwaysOnTop(true, 'screen-saver')
    pcWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) shell.openExternal(url)
      return { action: 'deny' }
    })
    pcWin.once('ready-to-show', () => pcWin?.showInactive())
    rendererUrl(pcWin, '#pricecheck')
  } else {
    pcWin.setBounds({ x, y, width: pcWin.getBounds().width, height })
    pcWin.showInactive()
    pcWin.webContents.send('overlay:event', { type: 'priceCheck', data: pcState } satisfies OverlayEvent)
  }
}

/** Ctrl+Alt+C в игре → разбор предмета → чтение в «Крафт» или окно прайс-чека. */
async function readItem(mode: 'read' | 'price') {
  // если в фокусе сам оверлей, Ctrl+C ушёл бы ему, а не игре
  const focused = win?.isFocused() || pcWin?.isFocused()
  const text = focused ? null : await copyItemText()
  const parsed = text ? parseItem(text) : null
  const item = parsed ? await withBaseType(parsed) : null
  if (mode === 'read' || !item) {
    userVisible = true
    if (win && !win.isVisible()) win.showInactive() // не забираем фокус у игры
    send({ type: 'item', item, mode: 'read' })
    send({ type: 'hotkey', id: 'read' })
    return
  }
  pcState = await defaultFilters(item, await currentLeague().catch(() => undefined))
  showPriceCheck()
}

const actions: Record<HotkeyId, () => void> = {
  toggle: toggleOverlay,
  read: () => void readItem('read'),
  price: () => void readItem('price'),
  stash: () => void toggleStash({ load: rendererUrl, league: currentLeague, icon: appIcon() }),
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
    icon: appIcon(),
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

  rendererUrl(win)
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
ipcMain.on('overlay:hide', () => hideAll())

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
ipcMain.handle('exchange:get', async (_e, force?: boolean) => exchangeData(await currentLeague(), !!force))
ipcMain.handle('exchange:icons', async (_e, ids?: string[]) => exchangeIcons(await currentLeague(), ids))
ipcMain.handle('maps:mods', () => mapMods())
const oppDeps: OppDeps = { settings: () => settings, league: currentLeague, emit: (data) => send({ type: 'opps', data }), onLimits: () => sendLimits() }
ipcMain.handle('opps:get', () => oppState())
ipcMain.handle('opps:scan', () => scanNow(oppDeps))
ipcMain.handle('opps:discover', async (_e, slot: SlotId, minDiv: number) => {
  try {
    return await discoverCombos(await currentLeague(), slot, minDiv)
  } finally {
    sendLimits()
  }
})
ipcMain.handle('opps:saveCombo', (_e, combo: DiscoveredCombo, name: string) => {
  saveCombo(combo, name)
  send({ type: 'opps', data: oppState() })
})
ipcMain.handle('items:bases', () => itemBases())
ipcMain.handle('items:mods', (_e, base: string) => itemMods(base))
ipcMain.handle('craft:addable', (_e, item: ParsedItem) => addableFor(item))
ipcMain.handle('craft:precraft', async (_e, item: ParsedItem, targets: number[], lang: Lang) => {
  try {
    return await precraftVariants(await currentLeague(), item, targets, lang, { customPrices: settings.customPrices })
  } finally {
    sendLimits()
  }
})
ipcMain.on('stash:close', () => closeStash())
if (process.env.POESMITH_DEBUG) ipcMain.handle('debug:stashLive', () => toggleStash({ load: rendererUrl, league: currentLeague, icon: appIcon() }))
if (process.env.POESMITH_DEBUG) ipcMain.handle('debug:stash', (_e, path: string) => debugStash({ load: rendererUrl, league: currentLeague, icon: appIcon() }, path))

ipcMain.handle('rates:divine', async () => {
  try {
    return (await getRates(await currentLeague())).divine
  } catch {
    return null
  }
})
ipcMain.handle('limits:get', () => limits())

// прайс-чек
ipcMain.handle('pc:get', () => pcState)
ipcMain.handle('pc:search', async (_e, item: ParsedItem, filters: PcFilter[]) => {
  try {
    return await pcSearch(await currentLeague(), item, filters)
  } finally {
    sendLimits()
  }
})
ipcMain.handle('pc:more', async (_e, item: ParsedItem, queryId: string, ids: string[]) => {
  try {
    return await pcMore(await currentLeague(), item, queryId, ids)
  } finally {
    sendLimits()
  }
})
ipcMain.on('pc:close', () => {
  pcVisible = false
  pcWin?.hide()
})

// отладка без игры: прайс-чек и крафт по тексту предмета (только с переменной окружения POESMITH_DEBUG)
if (process.env.POESMITH_DEBUG || process.env.EXILE_FORGE_DEBUG) {
  ipcMain.handle('debug:item', async (_e, text: string, mode: 'read' | 'price') => {
    const parsed = parseItem(text)
    if (!parsed) return false
    const item = await withBaseType(parsed)
    if (mode === 'read') send({ type: 'item', item, mode })
    else {
      pcState = await defaultFilters(item, await currentLeague().catch(() => undefined))
      showPriceCheck()
    }
    return true
  })
}

// крафт
onCraftStatus((s) => send({ type: 'craftData', data: s }))
ipcMain.handle('craft:status', () => craftStatus())
// рыночная цена целевого предмета: медиана 10 самых дешёвых похожих лотов
ipcMain.handle('craft:value', async (_e, item: ParsedItem): Promise<ValueEstimate> => {
  try {
    const st = await defaultFilters(item, await currentLeague().catch(() => undefined))
    const r = await pcSearch(await currentLeague(), item, st.filters)
    const vals = r.rows.slice(0, 10).map((x) => x.priceDiv).sort((a, b) => a - b)
    const mid = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : 0
    return { valueDiv: mid, count: vals.length, total: r.total, tradeUrl: r.tradeUrl }
  } finally {
    sendLimits()
  }
})
ipcMain.handle('icons:currency', (_e, ids: string[]) => currencyIcons(ids))
ipcMain.handle('craft:plan', async (_e, item: ParsedItem, targets: number[], lang: Lang, popts?: CraftPlanOptions) => {
  const league = await currentLeague()
  try {
    return await buildPlan(item, targets, lang, league, {
      customPrices: settings.customPrices,
      ignoreIlvl: !!popts?.ignoreIlvl,
      mode: popts?.mode,
      add: popts?.add,
      skipGoal: popts?.skipGoal,
      basePrice: popts?.mode === 'finish' ? undefined : (baseType, lvl, max) => basePrice(league, baseType, lvl, max)
    })
  } finally {
    sendLimits()
  }
})
// фоновые уведомления о выгодных крафтах по избранным профилям
const watcherDeps: WatcherDeps = {
  settings: () => settings,
  league: currentLeague,
  onLimits: sendLimits,
  openCraft: (item) => {
    userVisible = true
    win?.show()
    send({ type: 'openCraft', item })
  }
}
ipcMain.handle('watcher:check', () => checkNow(watcherDeps))

// журнал крафтов
ipcMain.handle('journal:list', () => listJournal())
ipcMain.handle('journal:add', (_e, entry: Omit<JournalEntry, 'id' | 'date'>) => addJournal(entry))
ipcMain.handle('journal:update', (_e, id: string, patch: Partial<JournalEntry>) => updateJournal(id, patch))
ipcMain.handle('journal:remove', (_e, id: string) => removeJournal(id))

// свои профили рынка
ipcMain.handle('profile:save', (_e, item: ParsedItem, filters: PcFilter[], name: string) => {
  try {
    addFromPriceCheck(item, filters, name.trim() || item.name)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('profile:delete', (_e, id: string) => removeCustom(id))

// таблица стоимостей Harvest — обычный JSON-файл, его можно открыть и поправить
ipcMain.handle('harvest:open', () => shell.openPath(harvestFile()))
ipcMain.handle('harvest:reset', () => resetHarvest())
ipcMain.on('craft:open', (_e, item: ParsedItem) => {
  userVisible = true
  if (win && !win.isVisible()) win.showInactive()
  send({ type: 'openCraft', item })
})

// обновления приложения
ipcMain.handle('update:get', () => updateState())
ipcMain.handle('update:check', () => checkForUpdates())
ipcMain.handle('update:download', () => downloadUpdate())
ipcMain.on('update:install', () => installUpdate())

app.on('second-instance', showOverlay)
app.whenReady().then(() => {
  settings = loadSettings()
  // без идентификатора приложения Windows не показывает уведомления
  app.setAppUserModelId('io.github.nightievvv.poesmith')
  createWindow()
  watchFocus()
  createTray({
    settings: () => settings,
    league: currentLeague,
    limits,
    craftData: craftStatus,
    visible: () => !!win?.isVisible(),
    toggle: toggleOverlay,
    openSettings: () => {
      showOverlay()
      send({ type: 'openTab', tab: 'settings' })
    },
    update: updateState,
    downloadUpdate: () => void downloadUpdate(),
    installUpdate
  })
  initUpdater((s) => send({ type: 'update', data: s }))
  startWatcher(watcherDeps)
  startOpportunities(oppDeps)
  registerHotkeys()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
