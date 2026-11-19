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
  /** нижняя граница цены на вкладке «Рынок» */
  marketMin: { value: number; currency: 'chaos' | 'divine' }
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

/** Реальный лот с трейда — чтобы увидеть фактические моды. */
export interface ExampleItem extends ParsedItem {
  price: string
  priceDiv: number
}

export interface MarketQuery {
  slot: SlotId
  subtype: string
  minValue: number
  minCurrency: 'chaos' | 'divine'
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
  /** 3–5 свежих лотов в пределах рыночной цены */
  examples?: ExampleItem[]
  /** целевой предмет для крафта по профилю: самая частая база + моды по порогам профиля */
  craftItem?: ParsedItem
  error?: string
}

export interface SlotMarket {
  slot: SlotId
  subtype: string
  /** нижняя граница цены, с которой сканировали, в Chaos */
  minChaos: number
  /** есть ли ещё не отсканированные профили для этого слота и типа */
  hasMore: boolean
  totalProfiles: number
  league: string
  scannedAt: number | null
  scanning: boolean
  progress?: { done: number; total: number }
  /** Chaos за 1 Divine на момент сканирования */
  divine?: number
  profiles: ProfileResult[]
  error?: string
}

export type ModKind = 'enchant' | 'implicit' | 'explicit' | 'crafted' | 'fractured'

export interface ItemMod {
  text: string
  kind: ModKind
  /** P1 — лучший префикс, S3 — суффикс третьего тира, R2 — крафт верстака второго ранга, Greater — тир эльдрич-имплисита */
  tier?: string
  gen?: 'prefix' | 'suffix'
  /** название аффикса, например "Cheetah's" */
  affix?: string
}

export type DamageType = 'fire' | 'cold' | 'lightning' | 'ele'

export interface ItemProps {
  quality?: number
  sockets?: { count: number; links: number; text: string }
  req?: { level?: number; str?: number; dex?: number; int?: number }
  weapon?: {
    phys?: [number, number]
    ele: { type: DamageType; min: number; max: number }[]
    chaos?: [number, number]
    crit?: number
    aps?: number
    pdps: number
    edps: number
    cdps: number
    dps: number
  }
  defence?: { ar?: number; ev?: number; es?: number; ward?: number; block?: number }
}

export interface ParsedItem {
  itemClass: string
  rarity: string
  name: string
  baseType: string
  itemLevel: number | null
  slot: SlotId | null
  mods: ItemMod[]
  props: ItemProps
  corrupted: boolean
}

// ---------- прайс-чек ----------
export interface PcFilter {
  key: string
  /** что показать в строке; для модов — текст мода */
  label: string
  kind: ModKind | 'pseudo' | 'base' | 'ilvl' | 'weapon' | 'defence' | 'sockets' | 'links'
  /** для гнёзд и связей: минимальное число гнёзд каждого цвета (белые — W) */
  colors?: { r: number | null; g: number | null; b: number | null; w: number | null }
  /** id фильтра на трейде (stat id или имя поля weapon/armour/misc) */
  statId?: string
  tier?: string
  /** значение на самом предмете */
  value: number | null
  min: number | null
  max: number | null
  enabled: boolean
  /** удалось ли сопоставить мод с фильтром трейда */
  matched: boolean
}

export interface PcRow {
  name: string
  ilvl: number | null
  price: string
  priceDiv: number
}

export interface PcResult {
  total: number
  rows: PcRow[]
  tradeUrl: string
  divine: number
}

export interface PriceCheckState {
  item: ParsedItem
  filters: PcFilter[]
}

// ---------- крафт ----------
export interface CraftCost {
  name: string
  /** «×1», «~40», «×1500» */
  count: string
  /** ожидаемая стоимость в Chaos (если известна цена) */
  chaos?: number
}

export interface CraftStep {
  kind: 'base' | 'implicit' | 'explicit' | 'bench' | 'finish'
  /** шаг доводки: нужен, только если мод не выпал на предыдущих шагах */
  optional?: boolean
  title: string
  detail?: string
  currency: CraftCost[]
  station?: string
  farm?: string
}

export interface CraftTarget {
  text: string
  kind: ModKind
  tier?: string
  gen?: 'prefix' | 'suffix' | 'implicit'
  /** нашли ли мод в данных игры */
  found: boolean
  /** откуда мод: база, эльдрич, порча, крафт… */
  source?: string
}

/** Один способ скрафтить предмет: основной метод + доводка оставшихся модов + имплиситы и финиш. */
export interface CraftVariant {
  name: string
  /** механики, задействованные в варианте: Currency, Essence, Fossil, Harvest, Meta-craft, Bench, Eldritch… */
  mechanics: string[]
  steps: CraftStep[]
  /** ожидаемая стоимость: основной метод + доводка с учётом шанса, что мод уже выпал */
  totalChaos: number | null
  /** заметки к варианту (риски, допущения) */
  notes: string[]
}

export interface CraftPlan {
  stage: string
  ilvl: number
  targets: CraftTarget[]
  /** варианты по возрастанию стоимости; первый — рекомендуемый */
  variants: CraftVariant[]
  divine: number | null
  warnings: string[]
}

export interface CraftDataStatus {
  ready: boolean
  loading: boolean
  version?: string
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
  | { type: 'priceCheck'; data: PriceCheckState | null }
  | { type: 'limits'; data: Limits }
  | { type: 'craftData'; data: CraftDataStatus }
  | { type: 'openCraft'; item: ParsedItem }

export interface Api {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeys: HotkeyResult }>
  getLeagues(): Promise<LeagueInfo>
  hasSession(): Promise<boolean>
  setSession(value: string): Promise<{ ok: boolean; error?: 'format' | 'encryption' }>
  clearSession(): Promise<void>
  suspendHotkeys(suspend: boolean): Promise<void>
  /** только кэш — трейд не трогает, чтобы не тратить лимиты */
  getMarket(q: MarketQuery): Promise<SlotMarket>
  /** сканировать первые профили или, с more = true, догрузить следующие */
  scanMarket(q: MarketQuery, more: boolean): Promise<void>
  /** курс Divine в Chaos для текущей лиги (poe.ninja, лимиты трейда не тратит) */
  getDivine(): Promise<number | null>
  getLimits(): Promise<Limits>
  /** последний прайс-чек (окно прайс-чека запрашивает его при открытии) */
  getPriceCheck(): Promise<PriceCheckState | null>
  /** поиск по выбранным фильтрам: 15 лотов от дешёвых к дорогим */
  pcSearch(item: ParsedItem, filters: PcFilter[]): Promise<PcResult>
  closePriceCheck(): void
  /** план крафта: targets — индексы модов item.mods, которые нужно получить */
  craftPlan(item: ParsedItem, targets: number[], lang: Lang): Promise<CraftPlan>
  craftDataStatus(): Promise<CraftDataStatus>
  /** открыть предмет во вкладке «Крафт» основного окна */
  openInCraft(item: ParsedItem): void
  hide(): void
  onEvent(cb: (e: OverlayEvent) => void): () => void
}
