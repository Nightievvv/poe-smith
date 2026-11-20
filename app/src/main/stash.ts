import { BrowserWindow, desktopCapturer, nativeImage, screen } from 'electron'
import { join } from 'path'
import type { OverlayEvent, StashShot } from '../shared/types'
import { gameClientRect } from './poe1/focus'

/**
 * Оверлей цен на вкладке склада: по горячей клавише снимаем экран, вырезаем левую часть окна игры (там склад)
 * и отдаём пиксели прозрачному окну поверх игры — оно само находит ячейки, предметы и числа и рисует цены.
 * Окно оверлея исключено из захвата экрана (setContentProtection), чтобы подписи не попадали в следующий снимок.
 */
let stashWin: BrowserWindow | null = null
let visible = false
let timer: NodeJS.Timeout | null = null
let busy = false
/** пока оверлей открыт, экран переснимается — цены следуют за сменой вкладки, а закрытый склад прячет оверлей */
const REFRESH_MS = 1500

export interface StashDeps {
  load(win: BrowserWindow, hash: string): void
  league(): Promise<string>
  icon?: Electron.NativeImage
}

function ensureWindow(deps: StashDeps, bounds: Electron.Rectangle) {
  if (stashWin && !stashWin.isDestroyed()) {
    stashWin.setBounds(bounds)
    return stashWin
  }
  stashWin = new BrowserWindow({
    ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, icon: deps.icon,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  stashWin.setAlwaysOnTop(true, 'screen-saver')
  stashWin.setIgnoreMouseEvents(true)
  stashWin.setContentProtection(true)
  deps.load(stashWin, '#stash')
  return stashWin
}

async function shoot(league: string): Promise<{ shot: StashShot; bounds: Electron.Rectangle } | null> {
  // окно игры (оконный режим тоже), иначе — монитор под курсором
  const rect = gameClientRect()
  const disp = rect ? screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const sf = disp.scaleFactor
  const physDisp = screen.dipToScreenRect(null, disp.bounds)
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.size.width * sf), height: Math.round(disp.size.height * sf) } })
  const src = sources.find((s) => s.display_id === String(disp.id)) ?? sources[0]
  if (!src) return null
  return cut(src.thumbnail, physDisp, rect ?? physDisp, league)
}

/** Вырезает область склада из снимка экрана img, который покрывает physDisp; game — клиентская область игры. */
function cut(img: Electron.NativeImage, physDisp: Electron.Rectangle, game: Electron.Rectangle, league: string, dipScale?: number) {
  const size = img.getSize()
  // масштаб снимка к физическим пикселям экрана (обычно 1)
  const k = size.width / physDisp.width
  const gx = Math.round((game.x - physDisp.x) * k), gy = Math.round((game.y - physDisp.y) * k)
  const gw = Math.round(game.width * k), gh = Math.round(game.height * k)
  // склад — слева, ширина ~0.62 высоты окна игры; сверху и снизу лишнее не берём
  const crop = { x: Math.max(0, gx), y: Math.max(0, gy + Math.round(0.08 * gh)), width: Math.min(gw, Math.round(0.64 * gh)), height: Math.round(0.74 * gh) }
  crop.width = Math.min(crop.width, size.width - crop.x)
  crop.height = Math.min(crop.height, size.height - crop.y)
  const part = img.crop(crop)
  const bgra = part.toBitmap()
  const ps = part.getSize()
  const data = new Uint8Array(ps.width * ps.height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgra[i + 2]
    data[i + 1] = bgra[i + 1]
    data[i + 2] = bgra[i]
    data[i + 3] = 255
  }
  // окно оверлея — поверх области игры, в DIP
  const bounds = dipScale
    ? { x: 0, y: 0, width: Math.round(game.width / dipScale), height: Math.round(game.height / dipScale) }
    : screen.screenToDipRect(null, { x: game.x, y: game.y, width: game.width, height: game.height })
  const scale = (gw / bounds.width) || 1
  return {
    shot: { data, width: ps.width, height: ps.height, screenH: gh, offX: crop.x - gx, offY: crop.y - gy, scale, league },
    bounds
  }
}

/** Горячая клавиша: показать (снять экран заново) или спрятать оверлей склада. */
export async function toggleStash(deps: StashDeps) {
  if (visible && stashWin && !stashWin.isDestroyed()) {
    closeStash()
    return
  }
  const res = await shoot(await deps.league()).catch(() => null)
  if (!res) return
  const w = ensureWindow(deps, res.bounds)
  visible = true
  const sendShot = (shot: StashShot) => w.webContents.send('overlay:event', { type: 'stash', data: shot } satisfies OverlayEvent)
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => sendShot(res.shot))
  else sendShot(res.shot)
  w.showInactive()
  if (timer) clearInterval(timer)
  timer = setInterval(async () => {
    if (!visible || busy || !stashWin || stashWin.isDestroyed()) return
    busy = true
    try {
      const next = await shoot(res.shot.league)
      if (next && visible) {
        stashWin.setBounds(next.bounds)
        sendShot(next.shot)
      }
    } catch {
      /* следующий снимок */
    } finally {
      busy = false
    }
  }, REFRESH_MS)
}

export function closeStash() {
  visible = false
  if (timer) clearInterval(timer)
  timer = null
  if (stashWin && !stashWin.isDestroyed()) {
    stashWin.webContents.send('overlay:event', { type: 'stash', data: null } satisfies OverlayEvent)
    stashWin.hide()
  }
}

export const stashVisible = () => visible

/** Отладка: оверлей по PNG-скриншоту вместо экрана; картинка показывается фоном. */
export function debugStash(deps: StashDeps, pngPath: string, dipScale = 2) {
  const img = nativeImage.createFromPath(pngPath)
  const sz = img.getSize()
  const r = { x: 0, y: 0, width: sz.width, height: sz.height }
  const res = cut(img, r, r, 'debug', dipScale)
  const w = ensureWindow(deps, res.bounds)
  w.setContentProtection(false)
  const shot = { ...res.shot, debugBg: img.toDataURL() }
  const go = () => w.webContents.send('overlay:event', { type: 'stash', data: shot } satisfies OverlayEvent)
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go)
  else go()
  w.showInactive()
  return res.bounds
}

/** HWND окна оверлея склада (для проверки «что видно поверх игры») */
export const stashWindow = () => (stashWin && !stashWin.isDestroyed() ? stashWin : null)
