import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ExampleItem, MarketQuery, ParsedItem, ProfileResult, Settings, SlotId, SlotMarket } from '../../shared/types'
import { listingToItem } from './listing'
import { analyze, type PricePoint } from '../../shared/analyze'
import { SLOT_CATEGORY, subtypeOf } from '../../shared/poe1/catalog'
import { profilesFor, profileTargetMods, type Profile } from './profiles'
import { buildQuery, type QuerySpec } from './query'
import { search, fetchListings, tradeUrl, type Listing } from './trade'
import { getRates, type Rates } from './ninja'

/** Сколько свежих лотов выгружаем на профиль: 2 запроса fetch. Больше лимиты трейда не позволяют. */
const SAMPLE = 20
/** Сколько профилей сканируем за одно нажатие «Найти» / «Загрузить ещё». */
const BATCH = 5
const EXAMPLES = 5

interface Store {
  /** версия формата: при смене формата примеров старые результаты сбрасываются, история цен остаётся */
  v?: number
  slots: Record<string, SlotMarket>
  /** league|profileId → история медиан */
  history: Record<string, { t: number; m: number }[]>
}

const VERSION = 4
const file = () => join(app.getPath('userData'), 'market-cache.json')
let store: Store = { v: VERSION, slots: {}, history: {} }
try {
  if (existsSync(file())) store = JSON.parse(readFileSync(file(), 'utf-8'))
  if (store.v !== VERSION) store = { v: VERSION, slots: {}, history: store.history ?? {} }
} catch {
  /* повреждённый кэш — начинаем заново */
}
const persist = () => writeFileSync(file(), JSON.stringify(store), 'utf-8')

export function minChaosOf(q: MarketQuery, rates: Rates | null): number {
  if (!q.minValue || q.minValue <= 0) return 0
  if (q.minCurrency === 'chaos') return Math.round(q.minValue)
  return rates ? Math.round(q.minValue * rates.divine) : 0
}
const key = (league: string, q: MarketQuery, minChaos: number) => `${league}|${q.slot}|${q.subtype}|${minChaos}`

function toPoints(listings: Listing[], rates: Rates): (PricePoint & { l: Listing })[] {
  const pts: (PricePoint & { l: Listing })[] = []
  for (const l of listings) {
    const pr = l.listing.price
    if (!pr) continue
    const chaos = rates.chaosPer[pr.currency]
    if (!chaos) continue // валюта без курса — пропускаем
    pts.push({ div: (pr.amount * chaos) / rates.divine, account: l.listing.account.name, indexed: l.listing.indexed, l })
  }
  return pts
}

function toExample(p: PricePoint & { l: Listing }, slot: SlotId): ExampleItem {
  const pr = p.l.listing.price!
  return { ...listingToItem(p.l, slot), price: `${pr.amount} ${pr.currency}`, priceDiv: p.div }
}

function trendFor(hist: { t: number; m: number }[] | undefined, median: number): number | null {
  if (!hist?.length || !median) return null
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const old = [...hist].reverse().find((h) => h.t <= weekAgo + 24 * 3600 * 1000)
  if (!old || !old.m) return null
  return Math.round(((median - old.m) / old.m) * 100)
}

/** Поиск + выгрузка + анализ. Используется и для профилей, и для проверки цены своего предмета. */
export async function runQuery(league: string, spec: QuerySpec, settings: Settings, slot: SlotId) {
  const rates = await getRates(league)
  const s = await search(league, buildQuery(spec, settings.maxAgeDays))
  const listings = s.result.length ? await fetchListings(s.result.slice(0, SAMPLE), s.id) : []
  const pts = toPoints(listings, rates)
  const stats = analyze(pts, settings.outlier)
  // примеры: свежие лоты разных продавцов в пределах рыночной цены
  const seen = new Set<string>()
  const examples: ExampleItem[] = []
  for (const p of pts) {
    if (examples.length >= EXAMPLES || seen.has(p.account) || p.div < stats.lo || p.div > stats.hi) continue
    seen.add(p.account)
    examples.push(toExample(p, slot))
  }
  const { values, lo, hi, median, q1, q3, kept, cut, sellers, fresh } = stats
  return { total: s.total, tradeUrl: tradeUrl(league, s.id), values, lo, hi, median, q1, q3, kept, cut, sellers, fresh, divine: rates.divine, examples }
}

function specFor(p: Profile, q: MarketQuery, minChaos: number): QuerySpec {
  const st = subtypeOf(q.slot, q.subtype)
  const defence = { ...(st.defence ?? {}) }
  for (const [k, v] of Object.entries(p.defence ?? {}) as ['ar' | 'ev' | 'es', number][]) defence[k] = { ...(defence[k] ?? {}), min: v }
  return {
    category: st.category ?? SLOT_CATEGORY[q.slot],
    rarity: p.rarity ?? 'rare',
    type: p.type ?? st.type,
    stats: p.stats,
    pdps: p.pdps,
    edps: p.edps,
    crit: p.crit,
    ilvl: p.ilvl,
    quality: p.quality,
    defence,
    minChaos
  }
}

/** Целевой предмет для крафта по профилю: самая частая база среди лотов + моды по порогам (или моды типичного лота). */
function craftItemFor(p: Profile, q: MarketQuery, examples: ExampleItem[], median: number): ParsedItem | undefined {
  const st = subtypeOf(q.slot, q.subtype)
  const counts = new Map<string, number>()
  for (const e of examples) counts.set(e.baseType, (counts.get(e.baseType) ?? 0) + 1)
  const baseType = p.type ?? st.type ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!baseType) return undefined
  const ilvl = Math.max(p.ilvl ?? 0, ...examples.map((e) => e.itemLevel ?? 0)) || 85
  const texts = profileTargetMods(p)
  const typical = [...examples].sort((a, b) => Math.abs(a.priceDiv - median) - Math.abs(b.priceDiv - median))[0]
  const mods = texts
    ? texts.map((text) => ({ text, kind: 'explicit' as const }))
    : (typical?.mods ?? []).filter((m) => m.kind !== 'implicit' && m.kind !== 'enchant').map((m) => ({ ...m, kind: m.kind === 'crafted' ? ('crafted' as const) : m.kind }))
  if (!mods.length) return undefined
  return { itemClass: '', rarity: p.rarity === 'magic' ? 'Magic' : 'Rare', name: '', baseType, itemLevel: ilvl, slot: q.slot, mods, props: {}, corrupted: false, valueDiv: median || undefined }
}

/** Только кэш: без запросов к трейду. */
export async function getCached(league: string, q: MarketQuery): Promise<SlotMarket> {
  const rates = await getRates(league).catch(() => null)
  const minChaos = minChaosOf(q, rates)
  const all = profilesFor(q.slot, q.subtype)
  return (
    store.slots[key(league, q, minChaos)] ?? {
      slot: q.slot, subtype: q.subtype, minChaos, hasMore: all.length > 0, totalProfiles: all.length,
      league, scannedAt: null, scanning: false, profiles: [], divine: rates?.divine
    }
  )
}

const running = new Set<string>()

export async function scan(league: string, q: MarketQuery, more: boolean, settings: Settings, emit: (m: SlotMarket) => void) {
  const rates = await getRates(league)
  const minChaos = minChaosOf(q, rates)
  const k = key(league, q, minChaos)
  if (running.has(k)) return
  running.add(k)
  const all = profilesFor(q.slot, q.subtype)
  const prev = more ? (store.slots[k]?.profiles ?? []) : []
  const todo = all.filter((p) => !prev.some((r) => r.id === p.id)).slice(0, BATCH)
  let cur: SlotMarket = {
    slot: q.slot, subtype: q.subtype, minChaos, league, totalProfiles: all.length, divine: rates.divine,
    hasMore: true, scanning: true, scannedAt: store.slots[k]?.scannedAt ?? null, profiles: prev,
    progress: { done: 0, total: todo.length }
  }
  emit(cur)
  const results = [...prev]
  try {
    for (const p of todo) {
      let r: ProfileResult
      try {
        const res = await runQuery(league, specFor(p, q, minChaos), settings, q.slot)
        const hk = `${league}|${p.id}|${minChaos}`
        const hist = (store.history[hk] ??= [])
        r = { id: p.id, name: p.name, base: p.type, recipe: p.recipe, ...res, trend: trendFor(hist, res.median), craftItem: craftItemFor(p, q, res.examples, res.median) }
        if (res.median) hist.push({ t: Date.now(), m: res.median })
        store.history[hk] = hist.slice(-200)
      } catch (e) {
        r = {
          id: p.id, name: p.name, recipe: p.recipe, total: 0, sellers: 0, values: [], lo: 0, hi: 0, median: 0, q1: 0, q3: 0,
          kept: 0, cut: 0, fresh: 0, trend: null, error: e instanceof Error ? e.message : String(e)
        }
      }
      results.push(r)
      cur = { ...cur, profiles: [...results], progress: { done: results.length - prev.length, total: todo.length } }
      emit(cur)
    }
    cur = { ...cur, scanning: false, progress: undefined, scannedAt: Date.now(), hasMore: results.length < all.length }
  } catch (e) {
    cur = { ...cur, scanning: false, progress: undefined, error: e instanceof Error ? e.message : String(e) }
  } finally {
    running.delete(k)
  }
  store.slots[k] = cur
  persist()
  emit(cur)
}
