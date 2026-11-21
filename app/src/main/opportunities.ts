import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { OppRow, OppState, ParsedItem, Settings, SlotId } from '../shared/types'
import { SLOT_CATEGORY } from '../shared/poe1/catalog'
import { profilesFor } from './poe1/profiles'
import { scanOne } from './poe1/market'
import { buildPlan } from './poe1/planner'
import { basePrice } from './poe1/baseprice'
import { limits } from './poe1/trade'

/**
 * «Возможности»: по всем профилям рынка — цена быстрой продажи, спрос, стоимость лучшего плана крафта и прибыль.
 * Сканер в фоне берёт самый давно проверенный профиль, но только когда у трейда есть запас лимитов
 * (не больше половины окна занято) — ручные прайс-чеки не должны ждать. Один профиль — не чаще раза в 2 часа.
 */
const FRESH_MS = 2 * 3600 * 1000
const TICK_MS = 25 * 1000
const file = () => join(app.getPath('userData'), 'opportunities.json')

let rows: Record<string, OppRow> = {}
let leagueOf = ''
try {
  if (existsSync(file())) {
    const raw = JSON.parse(readFileSync(file(), 'utf-8'))
    rows = raw.rows ?? {}
    leagueOf = raw.league ?? ''
  }
} catch {
  /* повреждённый файл — начнём заново */
}
const persist = () => writeFileSync(file(), JSON.stringify({ league: leagueOf, rows }), 'utf-8')

let busy = false
let current: string | null = null
let timer: NodeJS.Timeout | null = null

export interface OppDeps {
  settings: () => Settings
  league: () => Promise<string>
  emit: (s: OppState) => void
  onLimits: () => void
}

const allProfiles = () =>
  (Object.keys(SLOT_CATEGORY) as SlotId[]).flatMap((slot) => profilesFor(slot, 'any').map((p) => ({ slot, p })))

export function oppState(): OppState {
  return { rows: Object.values(rows), total: allProfiles().length, scanning: current, league: leagueOf }
}

/** Свободно ли у трейда: занято не больше половины окна лимитов и нет бана. */
function headroom() {
  const l = limits()
  return l.search.blockedFor === 0 && l.fetch.blockedFor === 0 && l.search.used <= l.search.max / 2 && l.fetch.used <= l.fetch.max / 2
}

async function scanProfile(deps: OppDeps, slot: SlotId, profileId: string) {
  const s = deps.settings()
  const league = await deps.league()
  if (league !== leagueOf) {
    rows = {}
    leagueOf = league
  }
  const q = { slot, subtype: 'any', minValue: 0, minCurrency: 'chaos' as const }
  const prof = profilesFor(slot, 'any').find((p) => p.id === profileId)
  const key = `${slot}|${profileId}`
  current = key
  deps.emit(oppState())
  try {
    const r = await scanOne(league, q, profileId, s)
    deps.onLimits()
    if (!r) return
    const base: OppRow = {
      key, slot, id: profileId, name: r.name, total: r.total, sales: r.sales ?? null, sellFast: r.q1, median: r.median,
      divine: r.divine ?? 0, tradeUrl: r.tradeUrl, scannedAt: Date.now(), custom: prof?.custom
    }
    if (!r.craftItem || !r.median || !r.divine) {
      rows[key] = { ...base, error: r.error ?? 'NO_CRAFT_ITEM' }
      return
    }
    const item: ParsedItem = { ...r.craftItem, name: r.name[s.lang] }
    const plan = await buildPlan(item, item.mods.map((_, i) => i), s.lang, league, {
      customPrices: s.customPrices,
      basePrice: (b, lvl, max) => basePrice(league, b, lvl, max)
    })
    deps.onLimits()
    const best = plan.variants[0]
    if (!best) {
      rows[key] = { ...base, error: 'NO_PLAN' }
      return
    }
    const cost = best.costP50 ?? (best.costMissMin + best.costMissMax) / 2
    rows[key] = { ...base, cost, costP90: best.costP90 ?? best.costMissMax, variant: best.name, mechanics: best.mechanics, craftItem: { ...item, valueDiv: r.q1 } }
  } catch (e) {
    rows[key] = { ...(rows[key] ?? { key, slot, id: profileId, name: prof?.name ?? { ru: profileId, en: profileId }, total: 0, sales: null, sellFast: 0, median: 0, divine: 0, scannedAt: Date.now() }), scannedAt: Date.now(), error: e instanceof Error ? e.message : String(e) }
  } finally {
    current = null
    persist()
    deps.emit(oppState())
  }
}

/** Следующий профиль: никогда не сканированные первыми, затем самые давние (не свежее 2 часов). */
function nextProfile(force: boolean) {
  const now = Date.now()
  const list = allProfiles()
    .map(({ slot, p }) => ({ slot, id: p.id, at: rows[`${slot}|${p.id}`]?.scannedAt ?? 0 }))
    .filter((x) => force || now - x.at > FRESH_MS)
    .sort((a, b) => a.at - b.at)
  return list[0] ?? null
}

async function tick(deps: OppDeps) {
  if (busy || !deps.settings().oppScan || !headroom()) return
  const n = nextProfile(false)
  if (!n) return
  busy = true
  try {
    await scanProfile(deps, n.slot, n.id)
  } finally {
    busy = false
  }
}

/** «Обновить сейчас»: несколько профилей подряд, даже если фоновое сканирование выключено. */
export async function scanNow(deps: OppDeps, count = 3) {
  if (busy) return
  busy = true
  try {
    for (let i = 0; i < count; i++) {
      const n = nextProfile(true)
      if (!n) break
      await scanProfile(deps, n.slot, n.id)
    }
  } finally {
    busy = false
  }
}

export function startOpportunities(deps: OppDeps) {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void tick(deps), TICK_MS)
}
