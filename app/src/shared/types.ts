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

export type SlotId =
  | 'helmet' | 'body' | 'gloves' | 'boots' | 'shield'
  | 'amulet' | 'ring' | 'belt'
  | 'weapon1' | 'weapon2' | 'quiver'
  | 'jewel' | 'abyss' | 'cluster'
  | 'flask'

export interface I18nText {
  ru: string
  en: string
}

export interface ProfileResult {
  id: string
  name: I18nText
  base?: string
  /** id рецепта крафта, если он есть */
  recipe?: string
  /** всего лотов по запросу (трейд отдаёт не больше 10000) */
  total: number
  sellers: number
  /** цены в Divine после схлопывания продавцов, по возрастанию */
  values: number[]
  lo: number
  hi: number
  median: number
  q1: number
  q3: number
  kept: number
  cut: number
  fresh: number
  /** изменение медианы за ~7 дней, % (null — истории ещё нет) */
  trend: number | null
  tradeUrl?: string
  /** Chaos за 1 Divine в момент запроса */
  divine?: number
  error?: string
}

export interface SlotMarket {
  slot: SlotId
  league: string
  scannedAt: number | null
  scanning: boolean
  progress?: { done: number; total: number }
  /** Chaos за 1 Divine на момент сканирования */
  divine?: number
  profiles: ProfileResult[]
  error?: string
}

export interface ParsedItem {
  itemClass: string
  rarity: string
  name: string
  baseType: string
  itemLevel: number | null
  slot: SlotId | null
  implicits: string[]
  mods: string[]
  corrupted: boolean
}

export interface PriceCheck {
  item: ParsedItem
  /** условия поиска, понятные человеку */
  criteria: string[]
  result: ProfileResult | null
  loading: boolean
  error?: string
}

export interface Limits {
  search: { used: number; max: number; period: number; blockedFor: number }
  fetch: { used: number; max: number; period: number; blockedFor: number }
}

export type OverlayEvent =
  | { type: 'hotkey'; id: HotkeyId }
  | { type: 'clickThrough'; value: boolean }
  | { type: 'market'; data: SlotMarket }
  | { type: 'item'; item: ParsedItem | null; mode: 'read' | 'price' }
  | { type: 'priceCheck'; data: PriceCheck }
  | { type: 'limits'; data: Limits }

export interface Api {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeys: HotkeyResult }>
  getLeagues(): Promise<LeagueInfo>
  hasSession(): Promise<boolean>
  setSession(value: string): Promise<{ ok: boolean; error?: 'format' | 'encryption' }>
  clearSession(): Promise<void>
  suspendHotkeys(suspend: boolean): Promise<void>
  /** вернуть кэш слота; если он устарел и автообновление включено — запустить сканирование */
  getMarket(slot: SlotId): Promise<SlotMarket>
  scanMarket(slot: SlotId): Promise<void>
  getLimits(): Promise<Limits>
  hide(): void
  onEvent(cb: (e: OverlayEvent) => void): () => void
}
