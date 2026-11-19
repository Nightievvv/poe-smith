import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CraftDataStatus, Limits, Settings } from '../shared/types'

/** Иконка приложения: в сборке лежит в resources, в разработке — в app/build. */
export function appIconPath(): string | null {
  const p = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png')
  return existsSync(p) ? p : null
}

export function appIcon(size?: number): NativeImage | undefined {
  const p = appIconPath()
  if (!p) return undefined
  const img = nativeImage.createFromPath(p)
  return size ? img.resize({ width: size, height: size, quality: 'best' }) : img
}

export interface TrayDeps {
  settings: () => Settings
  league: () => Promise<string>
  limits: () => Limits
  craftData: () => CraftDataStatus
  visible: () => boolean
  toggle: () => void
  openSettings: () => void
}

let tray: Tray | null = null

/** Иконка в трее: левый клик — показать/скрыть оверлей, правый — меню со статусом, настройками и выходом. */
export function createTray(deps: TrayDeps) {
  // без иконки Windows не покажет значок в трее — берём пустой 16×16, чтобы приложение всё равно работало
  const icon = appIcon(16) ?? nativeImage.createEmpty().resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Exile Forge')
  tray.on('click', () => deps.toggle())
  tray.on('right-click', async () => {
    const s = deps.settings()
    const ru = s.lang === 'ru'
    const T = (r: string, e: string) => (ru ? r : e)
    let league = '—'
    try {
      league = await deps.league()
    } catch {
      /* без сети показываем прочерк */
    }
    const l = deps.limits()
    const blocked = Math.max(l.search.blockedFor, l.fetch.blockedFor)
    const data = deps.craftData()
    const menu = Menu.buildFromTemplate([
      { label: 'Exile Forge', enabled: false },
      { type: 'separator' },
      { label: T(`Лига: ${league}`, `League: ${league}`), enabled: false },
      {
        label: blocked > 0
          ? T(`Трейд: пауза ${blocked} с (лимит запросов)`, `Trade: paused ${blocked}s (rate limit)`)
          : T(`Трейд: поиск ${l.search.used}/${l.search.max}, выгрузка ${l.fetch.used}/${l.fetch.max}`, `Trade: search ${l.search.used}/${l.search.max}, fetch ${l.fetch.used}/${l.fetch.max}`),
        enabled: false
      },
      {
        label: data.ready ? T(`Данные игры: ${data.version}`, `Game data: ${data.version}`)
          : data.loading ? T('Данные игры: загрузка…', 'Game data: loading…')
            : T('Данные игры: загрузятся при первом плане крафта', 'Game data: loaded on the first crafting plan'),
        enabled: false
      },
      { label: s.notify ? T('Уведомления: включены', 'Notifications: on') : T('Уведомления: выключены', 'Notifications: off'), enabled: false },
      { type: 'separator' },
      { label: deps.visible() ? T(`Скрыть оверлей (${s.hotkeys.toggle})`, `Hide overlay (${s.hotkeys.toggle})`) : T(`Показать оверлей (${s.hotkeys.toggle})`, `Show overlay (${s.hotkeys.toggle})`), click: deps.toggle },
      { label: T('Настройки', 'Settings'), click: deps.openSettings },
      { type: 'separator' },
      { label: T('Выход', 'Quit'), click: () => app.quit() }
    ])
    tray?.popUpContextMenu(menu)
  })
  return tray
}
