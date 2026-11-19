import type { Settings } from '../../shared/types'

export interface QuerySpec {
  category: string
  rarity: 'rare' | 'magic' | 'normal'
  type?: string
  stats?: { id: string; min?: number; max?: number }[]
  pdps?: number
  ilvl?: number
}

const INDEXED: Record<Settings['maxAgeDays'], string> = { 3: '3days', 7: '1week', 14: '2weeks' }

/** Тело запроса к /api/trade/search: свежие лоты с ценой, новые сначала (честная выборка цен, а не только самые дешёвые). */
export function buildQuery(q: QuerySpec, maxAgeDays: Settings['maxAgeDays']) {
  const filters: Record<string, unknown> = {
    type_filters: { filters: { category: { option: q.category }, rarity: { option: q.rarity } } },
    trade_filters: { filters: { indexed: { option: INDEXED[maxAgeDays] }, sale_type: { option: 'priced' } } }
  }
  if (q.pdps) filters.weapon_filters = { filters: { pdps: { min: q.pdps } } }
  if (q.ilvl) filters.misc_filters = { filters: { ilvl: { min: q.ilvl } } }
  const query: Record<string, unknown> = {
    status: { option: 'available' },
    stats: [{ type: 'and', filters: (q.stats ?? []).map((s) => ({ id: s.id, value: { min: s.min, max: s.max } })) }],
    filters
  }
  if (q.type) query.type = q.type
  return { query, sort: { indexed: 'desc' } }
}
