import { USER_AGENT } from '../leagues'

export interface Rates {
  /** сколько Chaos Orb стоит единица валюты, ключ — id валюты на трейде (chaos, divine, exalted…) */
  chaosPer: Record<string, number>
  /** Chaos за 1 Divine */
  divine: number
  at: number
}

const cache = new Map<string, Rates>()

export async function getRates(league: string): Promise<Rates> {
  const hit = cache.get(league)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit
  const url = `https://poe.ninja/poe1/api/economy/stash/current/currency/overview?league=${encodeURIComponent(league)}&type=Currency`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`poe.ninja: HTTP ${res.status}`)
  const j = (await res.json()) as {
    lines: { currencyTypeName: string; chaosEquivalent: number }[]
    currencyDetails: { name: string; tradeId?: string }[]
  }
  const tradeIdByName = new Map(j.currencyDetails.filter((d) => d.tradeId).map((d) => [d.name, d.tradeId!]))
  const chaosPer: Record<string, number> = { chaos: 1 }
  for (const l of j.lines) {
    const id = tradeIdByName.get(l.currencyTypeName)
    if (id && l.chaosEquivalent > 0) chaosPer[id] = l.chaosEquivalent
  }
  if (!chaosPer.divine) throw new Error('poe.ninja: нет курса Divine Orb')
  const rates = { chaosPer, divine: chaosPer.divine, at: Date.now() }
  cache.set(league, rates)
  return rates
}
