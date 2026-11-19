import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProfileResult, Settings, SlotId, SlotMarket } from '../../shared/types'
import { analyze, type PricePoint } from '../../shared/analyze'
import { profilesFor } from './profiles'
import { buildQuery, type QuerySpec } from './query'
import { search, fetchListings, tradeUrl, type Listing } from './trade'
import { getRates, type Rates } from './ninja'

/** Сколько свежих лотов выгружаем на профиль: 2 запроса fetch. Больше лимиты трейда не позволяют. */
const SAMPLE = 20

interface Store {
  slots: Record<string, SlotMarket>
  /** league|profileId → история медиан */
  history: Record<string, { t: number; m: number }[]>
}

const file = () => join(app.getPath('userData'), 'market-cache.json')
let store: Store = { slots: {}, history: {} }
try {
  if (existsSync(file())) store = JSON.parse(readFileSync(file(), 'utf-8'))
} catch {
  /* повреждённый кэш — начинаем заново */
}
const persist = () => writeFileSync(file(), JSON.stringify(store), 'utf-8')
const key = (league: string, slot: SlotId) => `${league}|${slot}`

function toPoints(listings: Listing[], rates: Rates): PricePoint[] {
  const pts: PricePoint[] = []
  for (const l of listings) {
    const pr = l.listing.price
    if (!pr) continue
    const chaos = rates.chaosPer[pr.currency]
    if (!chaos) continue // валюта без курса (редкие обменники) — пропускаем
    pts.push({ div: (pr.amount * chaos) / rates.divine, account: l.listing.account.name, indexed: l.listing.indexed })
  }
  return pts
}

function trendFor(hist: { t: number; m: number }[] | undefined, median: number): number | null {
  if (!hist?.length || !median) return null
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  // самая свежая точка, которой не меньше ~6 дней
  const old = [...hist].reverse().find((h) => h.t <= weekAgo + 24 * 3600 * 1000)
  if (!old || !old.m) return null
  return Math.round(((median - old.m) / old.m) * 100)
}

/** Поиск + выгрузка + анализ. Используется и для профилей, и для проверки цены своего предмета. */
export async function runQuery(league: string, spec: QuerySpec, settings: Settings) {
  const rates = await getRates(league)
  const s = await search(league, buildQuery(spec, settings.maxAgeDays))
  const listings = s.result.length ? await fetchListings(s.result.slice(0, SAMPLE), s.id) : []
  const stats = analyze(toPoints(listings, rates), settings.outlier)
  const { values, lo, hi, median, q1, q3, kept, cut, sellers, fresh } = stats
  return {
    total: s.total,
    tradeUrl: tradeUrl(league, s.id),
    values, lo, hi, median, q1, q3, kept, cut, sellers, fresh,
    divine: rates.divine
  }
}

export function getSlot(league: string, slot: SlotId): SlotMarket {
  return store.slots[key(league, slot)] ?? { slot, league, scannedAt: null, scanning: false, profiles: [] }
}

export function isStale(m: SlotMarket, settings: Settings) {
  if (!m.scannedAt) return true
  if (settings.scanInterval === 'manual') return false
  const ttl = settings.scanInterval === '1h' ? 3600e3 : 1800e3
  return Date.now() - m.scannedAt > ttl
}

const running = new Set<string>()

export async function scanSlot(league: string, slot: SlotId, settings: Settings, emit: (m: SlotMarket) => void) {
  const k = key(league, slot)
  if (running.has(k)) return
  running.add(k)
  const profiles = profilesFor(slot)
  const prev = getSlot(league, slot)
  let cur: SlotMarket = { ...prev, scanning: true, progress: { done: 0, total: profiles.length }, error: undefined }
  emit(cur)
  const results: ProfileResult[] = []
  try {
    for (const p of profiles) {
      let r: ProfileResult
      try {
        const q = await runQuery(league, p, settings)
        const hk = `${league}|${p.id}`
        const hist = (store.history[hk] ??= [])
        r = { id: p.id, name: p.name, base: p.type, recipe: p.recipe, ...q, trend: trendFor(hist, q.median) }
        if (q.median) hist.push({ t: Date.now(), m: q.median })
        store.history[hk] = hist.slice(-200)
        cur = { ...cur, divine: q.divine }
      } catch (e) {
        r = {
          id: p.id, name: p.name, recipe: p.recipe, total: 0, sellers: 0, values: [], lo: 0, hi: 0, median: 0, q1: 0, q3: 0,
          kept: 0, cut: 0, fresh: 0, trend: null, error: e instanceof Error ? e.message : String(e)
        }
      }
      results.push(r)
      // пока сканируем, показываем новые результаты вместе со старыми
      const merged = profiles.map((pp) => results.find((x) => x.id === pp.id) ?? prev.profiles.find((x) => x.id === pp.id)).filter(Boolean) as ProfileResult[]
      cur = { ...cur, profiles: merged, progress: { done: results.length, total: profiles.length } }
      emit(cur)
    }
    cur = { ...cur, scanning: false, progress: undefined, scannedAt: Date.now(), profiles: results }
  } catch (e) {
    cur = { ...cur, scanning: false, progress: undefined, error: e instanceof Error ? e.message : String(e) }
  } finally {
    running.delete(k)
  }
  store.slots[k] = { ...cur, scanning: false }
  persist()
  emit(cur)
}
