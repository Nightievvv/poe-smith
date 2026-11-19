import type { Settings } from '../../shared/types'
import type { DefenceFilter } from '../../shared/poe1/catalog'

export interface QuerySpec {
  category: string
  rarity: 'rare' | 'magic' | 'normal'
  type?: string
  stats?: { id: string; min?: number; max?: number }[]
  pdps?: number
  edps?: number
  crit?: number
  ilvl?: number
  quality?: number
  defence?: DefenceFilter
  /** нижняя граница цены в Chaos-эквиваленте (трейд сам пересчитывает лоты в Divine и других валютах) */
  minChaos?: number
}

const INDEXED: Record<Settings['maxAgeDays'], string> = { 3: '3days', 7: '1week', 14: '2weeks' }

/** Тело запроса к /api/trade/search: свежие лоты с ценой, новые сначала (честная выборка цен, а не только самые дешёвые). */
export function buildQuery(q: QuerySpec, maxAgeDays: Settings['maxAgeDays']) {
  const trade: Record<string, unknown> = { indexed: { option: INDEXED[maxAgeDays] }, sale_type: { option: 'priced' } }
  if (q.minChaos && q.minChaos > 0) trade.price = { min: Math.round(q.minChaos) }
  const filters: Record<string, unknown> = {
    type_filters: { filters: { category: { option: q.category }, rarity: { option: q.rarity } } },
    trade_filters: { filters: trade }
  }
  const weapon: Record<string, unknown> = {}
  if (q.pdps) weapon.pdps = { min: q.pdps }
  if (q.edps) weapon.edps = { min: q.edps }
  if (q.crit) weapon.crit = { min: q.crit }
  if (Object.keys(weapon).length) filters.weapon_filters = { filters: weapon }
  if (q.defence && Object.keys(q.defence).length) filters.armour_filters = { filters: q.defence }
  const misc: Record<string, unknown> = {}
  if (q.ilvl) misc.ilvl = { min: q.ilvl }
  if (q.quality) misc.quality = { min: q.quality }
  if (Object.keys(misc).length) filters.misc_filters = { filters: misc }
  const query: Record<string, unknown> = {
    status: { option: 'available' },
    stats: [{ type: 'and', filters: (q.stats ?? []).map((s) => ({ id: s.id, value: { min: s.min, max: s.max } })) }],
    filters
  }
  if (q.type) query.type = q.type
  return { query, sort: { indexed: 'desc' } }
}
