import { net } from 'electron'
import type { LeagueInfo } from '../shared/types'

export const USER_AGENT = 'ExileForge/0.1 (personal overlay tool)'

const TRADE_LEAGUES = 'https://www.pathofexile.com/api/trade/data/leagues'
const FALLBACK: LeagueInfo = {
  leagues: [
    { id: 'Standard', text: 'Standard' },
    { id: 'Hardcore', text: 'Hardcore' }
  ],
  currentSoftcore: null
}

let cache: { at: number; info: LeagueInfo } | null = null

/** Текущая Softcore трейд-лига — первая лига, которая не Standard/Hardcore/SSF/Ruthless. */
function pickCurrentSoftcore(ids: string[]): string | null {
  return ids.find((id) => !/standard|hardcore|\bhc\b|ssf|solo self-found|ruthless/i.test(id)) ?? null
}

export async function fetchLeagues(): Promise<LeagueInfo> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.info
  try {
    const res = await net.fetch(TRADE_LEAGUES, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { result: { id: string; realm: string; text: string }[] }
    const leagues = json.result.filter((l) => l.realm === 'pc').map((l) => ({ id: l.id, text: l.text }))
    const info: LeagueInfo = { leagues, currentSoftcore: pickCurrentSoftcore(leagues.map((l) => l.id)) }
    cache = { at: Date.now(), info }
    return info
  } catch (e) {
    return { ...FALLBACK, error: e instanceof Error ? e.message : String(e) }
  }
}
