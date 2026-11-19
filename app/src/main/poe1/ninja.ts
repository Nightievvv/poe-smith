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
