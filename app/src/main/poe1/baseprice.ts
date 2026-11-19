import { search, fetchListings } from './trade'
import { getRates } from './ninja'

/** Цена белой базы нужного уровня: медиана 5 самых дешёвых лотов (1 поиск + 1 выгрузка). Кэш 30 минут. */
const cache = new Map<string, { at: number; v: { chaos: number; count: number } | null }>()

export async function basePrice(league: string, baseType: string, ilvl: number): Promise<{ chaos: number; count: number } | null> {
  const key = `${league}|${baseType}|${ilvl}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.v
  const rates = await getRates(league)
  const query = {
    status: { option: 'available' },
    type: baseType,
    stats: [{ type: 'and', filters: [] }],
    filters: {
      type_filters: { filters: { rarity: { option: 'normal' } } },
      misc_filters: { filters: { ilvl: { min: ilvl }, corrupted: { option: 'false' } } },
      trade_filters: { filters: { sale_type: { option: 'priced' } } }
    }
  }
  const s = await search(league, { query, sort: { price: 'asc' } })
  const listings = s.result.length ? await fetchListings(s.result.slice(0, 10), s.id) : []
  const vals = listings
    .map((l) => l.listing.price)
    .filter((p): p is NonNullable<typeof p> => !!p && !!rates.chaosPer[p.currency])
    .map((p) => p.amount * rates.chaosPer[p.currency])
    .sort((a, b) => a - b)
    .slice(0, 5)
  const v = vals.length ? { chaos: vals[Math.floor((vals.length - 1) / 2)], count: vals.length } : null
  cache.set(key, { at: Date.now(), v })
  return v
}
