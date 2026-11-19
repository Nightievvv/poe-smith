export type Lang = 'ru' | 'en'
export type Game = 'poe1' | 'poe2'

export type HotkeyId = 'toggle' | 'read' | 'price' | 'click' | 'step' | 'tab'

/** global — работает поверх игры; local — только когда окно оверлея в фокусе */
export const HOTKEY_SCOPE: Record<HotkeyId, 'global' | 'local'> = {
  toggle: 'global',
  read: 'global',
  price: 'global',
  click: 'global',
  step: 'local',
  tab: 'local'
}

export const HOTKEY_ORDER: HotkeyId[] = ['toggle', 'read', 'price', 'click', 'step', 'tab']

export type OutlierMode = 'iqr1.5' | 'iqr3' | 'p10-90'
export type ScanInterval = '30m' | '1h' | 'manual'

export interface Settings {
  lang: Lang
  game: Game
  /** '' — автоматически текущая трейд-лига Softcore */
  league: string
  hotkeys: Record<HotkeyId, string>
  opacity: number
  clickThrough: boolean
  scanInterval: ScanInterval
  outlier: OutlierMode
  maxAgeDays: 3 | 7 | 14
  window: { x?: number; y?: number; width?: number; height?: number }
}

export interface League {
  id: string
  text: string
}

export interface LeagueInfo {
  leagues: League[]
  /** id текущей Softcore трейд-лиги, если удалось определить */
  currentSoftcore: string | null
  error?: string
}

export interface HotkeyResult {
  /** горячие клавиши, которые не удалось зарегистрировать (заняты другой программой или неверные) */
  failed: HotkeyId[]
}

export type OverlayEvent =
  | { type: 'hotkey'; id: HotkeyId }
  | { type: 'clickThrough'; value: boolean }

export interface Api {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeys: HotkeyResult }>
  getLeagues(): Promise<LeagueInfo>
  hasSession(): Promise<boolean>
  setSession(value: string): Promise<{ ok: boolean; error?: 'format' | 'encryption' }>
  clearSession(): Promise<void>
  suspendHotkeys(suspend: boolean): Promise<void>
  hide(): void
  onEvent(cb: (e: OverlayEvent) => void): () => void
}
