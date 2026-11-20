export type Lang = 'ru' | 'en'
export type Game = 'poe1' | 'poe2'

export type HotkeyId = 'toggle' | 'read' | 'price' | 'stash' | 'click' | 'step' | 'tab'

/** global — работает поверх игры; local — только когда окно оверлея в фокусе */
export const HOTKEY_SCOPE: Record<HotkeyId, 'global' | 'local'> = {
  toggle: 'global',
  read: 'global',
  price: 'global',
  stash: 'global',
  click: 'global',
  step: 'local',
  tab: 'local'
}

export const HOTKEY_ORDER: HotkeyId[] = ['toggle', 'read', 'price', 'stash', 'click', 'step', 'tab']

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
  /** свои цены в Chaos для валюты, которой нет на poe.ninja (рекомбинаторы, редкие звери…) */
  customPrices: Record<string, number>
  /** показывать оверлей только когда активна игра (или само окно оверлея) */
  onlyWhenGameFocused: boolean
  /** избранные профили рынка — их проверяет фоновый поиск выгодных крафтов */
  favorites: FavoriteProfile[]
  notify: boolean
  notifyEveryMin: 60 | 120 | 240
  window: { x?: number; y?: number; width?: number; height?: number }
}

export interface FavoriteProfile {
  profileId: string
  name: { ru: string; en: string }
  slot: SlotId
  subtype: string
  minValue: number
  minCurrency: 'chaos' | 'divine'
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
  /** свой профиль пользователя */
  custom?: boolean
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
  /** рыночная цена готового предмета в Divine, если известна (профиль, лот, прайс-чек) */
  valueDiv?: number
}

export interface ValueEstimate {
  valueDiv: number
  /** по скольким лотам считали */
  count: number
  total: number
  tradeUrl: string
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
  gen?: 'prefix' | 'suffix'
}

export interface PcRow {
  name: string
  ilvl: number | null
  price: string
  priceDiv: number
  /** полный предмет лота — для раскрываемой карточки */
  item?: ParsedItem
}

/** Иконка валюты трейда: id трейда (chaos, divine…) → картинка (data URL) и название. */
export interface CurrencyIcon {
  src: string
  name: string
}

export interface PcResult {
  total: number
  rows: PcRow[]
  tradeUrl: string
  divine: number
  /** id поиска на трейде и ещё не загруженные лоты — для «Загрузить ещё» */
  queryId?: string
  rest?: string[]
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
  /** расход зависит от удачи (попытки) — для него считается диапазон 50–100% */
  attempts?: boolean
  /** расход только на промахи (Annulment, повторные крафты) — входит в цену «с промахами» */
  miss?: boolean
}

/** Строка описания шага: обычное предложение или мод (префикс/суффикс), который выводится с отступом и цветом стороны. */
export type StepLine = string | { mod: string; gen?: 'prefix' | 'suffix' } | { warn: string }

export interface CraftStep {
  kind: 'base' | 'implicit' | 'explicit' | 'bench' | 'finish'
  /** шаг доводки: нужен, только если мод не выпал на предыдущих шагах */
  optional?: boolean
  /** метод крафта этого шага (Currency, Essence, Harvest, Beastcraft…) — подпись «в коробке» */
  method?: string
  title: string
  /** описание: каждое смысловое предложение — отдельная строка */
  lines?: StepLine[]
  currency: CraftCost[]
  station?: string
  farm?: string
  /** стоимость шага без промахов и с промахами, Chaos [мин, макс] */
  cost?: [number, number]
  costMiss?: [number, number]
  /** служебное: риск снять нужные моды, Chaos (входит в costMiss) */
  lossChaos?: number
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
  /** диапазон стоимости: попытки считаются от 50% до 100% расчётного количества */
  costMin: number
  costMax: number
  /** то же с учётом промахов (Annulment, повторная доводка снятых модов) */
  costMissMin: number
  costMissMax: number
  /** заметки к варианту (риски, допущения) */
  notes: string[]
  /** тот же вариант, но доводка подобрана для каждого мода по отдельности (основные поля — для всех модов сразу) */
  single?: { steps: CraftStep[]; totalChaos: number | null; costMin: number; costMax: number; costMissMin: number; costMissMax: number; mechanics: string[] }
}

export interface CraftPlanOptions {
  /** не ограничивать ilvl базы уровнем образца */
  ignoreIlvl?: boolean
}

export interface CraftPlan {
  stage: string
  ilvl: number
  /** верхняя граница ilvl базы (null — без ограничения) */
  ilvlMax: number | null
  /** план построен без учёта ilvl образца */
  ignoreIlvl?: boolean
  targets: CraftTarget[]
  /** варианты по возрастанию стоимости; первый — рекомендуемый */
  variants: CraftVariant[]
  divine: number | null
  warnings: string[]
  /** валюта без цены — её можно указать вручную (Settings.customPrices) */
  missingPrices: string[]
}

/** Запись журнала крафтов: план против факта. Суммы в Chaos. */
export interface JournalEntry {
  id: string
  date: number
  itemName: string
  baseType: string
  variant: string
  mechanics: string[]
  plannedMin: number
  plannedMax: number
  /** ожидаемая цена продажи на момент плана */
  valueChaos: number | null
  spentChaos: number | null
  soldChaos: number | null
  status: 'crafting' | 'done' | 'sold' | 'failed'
  note?: string
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

/** Состояние обновления приложения (GitHub Releases). disabled — запуск из исходников. */
export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  /** текущая версия приложения */
  current: string
  /** найденная новая версия */
  version?: string
  /** процент скачивания */
  progress?: number
  checkedAt?: number
  error?: string
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
  | { type: 'openTab'; tab: 'craft' | 'market' | 'currency' | 'regex' | 'journal' | 'settings' }
  | { type: 'stash'; data: StashShot | null }
  | { type: 'update'; data: UpdateState }

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
  /** следующие лоты того же поиска */
  pcMore(item: ParsedItem, queryId: string, ids: string[]): Promise<{ rows: PcRow[]; rest: string[] }>
  closePriceCheck(): void
  /** план крафта: targets — индексы модов item.mods, которые нужно получить */
  craftPlan(item: ParsedItem, targets: number[], lang: Lang, opts?: CraftPlanOptions): Promise<CraftPlan>
  craftDataStatus(): Promise<CraftDataStatus>
  /** проверить избранные профили прямо сейчас (обычно — раз в N минут в фоне) */
  checkFavorites(): Promise<void>
  journalList(): Promise<JournalEntry[]>
  journalAdd(e: Omit<JournalEntry, 'id' | 'date'>): Promise<JournalEntry>
  journalUpdate(id: string, patch: Partial<JournalEntry>): Promise<void>
  journalRemove(id: string): Promise<void>
  /** сохранить включённые фильтры прайс-чека как свой профиль рынка */
  saveProfile(item: ParsedItem, filters: PcFilter[], name: string): Promise<{ ok: boolean; error?: string }>
  deleteProfile(id: string): Promise<void>
  /** открыть JSON с таблицей стоимостей Harvest / вернуть значения по умолчанию */
  openHarvestFile(): Promise<void>
  resetHarvestFile(): Promise<void>
  /** рыночная цена предмета: медиана 10 самых дешёвых похожих лотов (1 поиск на трейде) */
  estimateValue(item: ParsedItem): Promise<ValueEstimate>
  /** открыть предмет во вкладке «Крафт» основного окна */
  openInCraft(item: ParsedItem): void
  /** иконки валюты по id трейда (chaos, divine…); недоступные пропускаются */
  currencyIcons(ids: string[]): Promise<Record<string, CurrencyIcon>>
  hide(): void
  /** биржа poe.ninja для текущей лиги (force — мимо 15-минутного кэша) */
  exchange(force?: boolean): Promise<ExchangeData>
  /** иконки предметов биржи (data URL) по id; без ids — все */
  exchangeIcons(ids?: string[]): Promise<Record<string, string>>
  /** оверлей склада: закрыть */
  stashClose(): void
  /** моды карт для генератора regex */
  mapMods(): Promise<MapModData>
  /** базы предметов и моды выбранной базы для генератора regex предметов */
  itemBases(): Promise<{ name: string; itemClass: string }[]>
  itemMods(base: string): Promise<ItemModData | null>
  /** обновления: проверка только сообщает о версии, скачивание и установка — по кнопке */
  updateState(): Promise<UpdateState>
  checkUpdate(): Promise<UpdateState>
  downloadUpdate(): Promise<void>
  installUpdate(): void
  onEvent(cb: (e: OverlayEvent) => void): () => void
}

/** Предмет биржи poe.ninja. */
export interface ExchangeItem {
  id: string
  name: string
  /** тип запроса poe.ninja: Currency, Fragment, Essence… */
  type: string
  /** подкатегория из ответа (Catalysts, Keepers…) */
  category: string
  chaos: number
  /** объём торгов за час, в Chaos */
  volume: number
  /** изменение цены за 7 дней, % */
  change: number | null
  /** точки тренда за 7 дней (% к началу) */
  spark: (number | null)[]
  /** путь картинки на web.poecdn.com */
  image: string
}

export interface ExchangeData {
  league: string
  /** Chaos за 1 Divine */
  divine: number
  items: ExchangeItem[]
  at: number
}

/** Снимок области склада для оверлея цен: пиксели RGBA и где они лежат на экране. */
export interface StashShot {
  /** RGBA */
  data: Uint8Array
  width: number
  height: number
  /** полная высота экрана в пикселях снимка: по ней масштабируется весь интерфейс PoE */
  screenH: number
  /** смещение снимка от левого верхнего угла экрана, в пикселях снимка */
  offX: number
  offY: number
  /** во сколько раз пиксели снимка больше CSS-пикселей окна оверлея */
  scale: number
  league: string
  /** только для отладки: исходная картинка фоном */
  debugBg?: string
}

/** Мод карты для генератора regex (тиры склеены). */
export interface MapModInfo {
  id: string
  /** текст для показа, с общим диапазоном чисел по тирам (строки разделены переводом строки) */
  text: string
  gen: 'prefix' | 'suffix'
  /** мод карт T17 (uber) */
  t17: boolean
  /** строки в нижнем регистре, числа заменены на # — по ним ищется уникальный фрагмент */
  match: string[]
}

export interface MapModData {
  mods: MapModInfo[]
  /** прочий текст, который бывает на картах (свойства, имплиситы) — фрагменты не должны с ним совпадать */
  corpus: string[]
}

/** Группа модов предмета (один тип мода, все тиры) для генератора regex предметов. */
export interface ItemModGroup {
  id: string
  gen: 'prefix' | 'suffix'
  /** текст лучшего тира */
  text: string
  /** строки шаблона в нижнем регистре, числа — # */
  match: string[]
  /** тиры от лучшего: текст, нужный ilvl, минимальное значение первого числа */
  tiers: { text: string; ilvl: number; min: number | null }[]
}

export interface ItemModData {
  base: string
  itemClass: string
  groups: ItemModGroup[]
}
