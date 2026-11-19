import { Limiter } from './ratelimit'
import { getSession } from '../settings'
import { USER_AGENT } from '../leagues'

const BASE = 'https://www.pathofexile.com/api/trade'

// значения по умолчанию совпадают с тем, что сервер отдавал в ноябре 2026; дальше берутся из заголовков
const searchLimiter = new Limiter('5:10:60,15:60:300,30:300:1800')
const fetchLimiter = new Limiter('12:4:10,16:12:300,50:300:300')

export interface Listing {
  id: string
  listing: {
    indexed: string
    price?: { type: string; amount: number; currency: string }
    account: { name: string }
  }
  item: {
    baseType: string
    typeLine: string
    name?: string
    ilvl?: number
    rarity?: string
    corrupted?: boolean
    implicitMods?: RawMod[]
    explicitMods?: RawMod[]
    craftedMods?: RawMod[]
    fracturedMods?: RawMod[]
    enchantMods?: RawMod[]
    properties?: { name: string; values: [string, number][] }[]
    requirements?: { name: string; values: [string, number][] }[]
    sockets?: { group: number; sColour: string }[]
    extended?: { category?: string; dps?: number; pdps?: number; edps?: number }
  }
}

/** Трейд отдаёт моды строками (старый формат) или объектами с тирами (новый). */
export type RawMod = string | { description: string; domain?: string; flags?: { crafted?: boolean; fractured?: boolean }; mods?: { tier?: string; name?: string }[] }

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  if (json) h['Content-Type'] = 'application/json'
  const s = getSession()
  if (s) h.Cookie = `POESESSID=${s}`
  return h
}

async function readJson(res: Response) {
  const text = await res.text()
  let j: any = null
  try {
    j = JSON.parse(text)
  } catch {
    /* не JSON */
  }
  if (!res.ok) {
    // сервер трейда лежит или на обслуживании — интерфейс покажет понятное сообщение
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error('TRADE_UNAVAILABLE')
    const msg = j?.error?.message ?? `HTTP ${res.status}`
    throw new Error(res.status === 429 ? `rate limit: ${msg}` : msg)
  }
  return j
}

export async function search(league: string, body: unknown): Promise<{ id: string; result: string[]; total: number }> {
  const res = await searchLimiter.schedule(() =>
    fetch(`${BASE}/search/${encodeURIComponent(league)}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body) })
  )
  return readJson(res)
}

export async function fetchListings(ids: string[], queryId: string): Promise<Listing[]> {
  const out: Listing[] = []
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10)
    const res = await fetchLimiter.schedule(() =>
      fetch(`${BASE}/fetch/${chunk.join(',')}?query=${encodeURIComponent(queryId)}`, { headers: headers() })
    )
    const j = await readJson(res)
    out.push(...(j.result as (Listing | null)[]).filter((x): x is Listing => !!x))
  }
  return out
}

export function tradeUrl(league: string, queryId: string) {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${queryId}`
}

export function limits() {
  return { search: searchLimiter.state(), fetch: fetchLimiter.state() }
}
