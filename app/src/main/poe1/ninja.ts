import { USER_AGENT } from '../leagues'

export interface Rates {
  /** сколько Chaos Orb стоит единица валюты, ключ — id валюты на трейде (chaos, divine, exalted…) */
  chaosPer: Record<string, number>
  /** Chaos за 1 Divine */
  divine: number
  at: number
}

const cache = new Map<string, Rates>()

/**
 * Курсы с биржи валют (Currency Exchange) — те же, что показывает сайт poe.ninja.
 * Раньше использовался эндпоинт по лотам в тайниках (stash): там мало данных, и курс Divine был занижен в ~3 раза.
 * id в ответе совпадают с id валют на трейде, поэтому сопоставление не нужно.
 */
const books = new Map<string, { at: number; byName: Map<string, number> }>()

/** Цены валюты, эссенций, фоссилий и резонаторов по английскому названию (в Chaos) — для оценки стоимости крафта. */
export async function getPriceBook(league: string): Promise<Map<string, number>> {
  const hit = books.get(league)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.byName
  const byName = new Map<string, number>([['Chaos Orb', 1]])
  for (const type of ['Currency', 'Essence', 'Fossil', 'Resonator']) {
    try {
      const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (!res.ok) continue
      const j = (await res.json()) as { lines: { id: string; primaryValue: number }[]; items?: { id: string; name: string }[] }
      const names = new Map((j.items ?? []).map((i) => [i.id, i.name]))
      for (const l of j.lines) {
        const n = names.get(l.id)
        if (n && l.primaryValue > 0) byName.set(n, l.primaryValue)
      }
    } catch {
      /* без цен этого типа план всё равно строится */
    }
  }
  // звери для бист-крафта продаются не на бирже — берём из обзора лотов poe.ninja
  try {
    const url = `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=Beast`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (res.ok) {
      const j = (await res.json()) as { lines: { name: string; chaosValue: number }[] }
      for (const l of j.lines) if (l.chaosValue > 0 && !byName.has(l.name)) byName.set(l.name, l.chaosValue)
    }
  } catch {
    /* без зверей план строится без бист-крафта */
  }
  books.set(league, { at: Date.now(), byName })
  return byName
}

export async function getRates(league: string): Promise<Rates> {
  const hit = cache.get(league)
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit
  const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`poe.ninja: HTTP ${res.status}`)
  const j = (await res.json()) as { core?: { primary?: string }; lines: { id: string; primaryValue: number }[] }
  if (j.core?.primary && j.core.primary !== 'chaos') throw new Error(`poe.ninja: неожиданная базовая валюта ${j.core.primary}`)
  const chaosPer: Record<string, number> = { chaos: 1 }
  for (const l of j.lines) if (l.primaryValue > 0) chaosPer[l.id] = l.primaryValue
  if (!chaosPer.divine) throw new Error('poe.ninja: нет курса Divine Orb')
  const rates = { chaosPer, divine: chaosPer.divine, at: Date.now() }
  cache.set(league, rates)
  return rates
}
