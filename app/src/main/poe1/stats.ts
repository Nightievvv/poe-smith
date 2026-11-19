import { app } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { USER_AGENT } from '../leagues'
import type { ModKind } from '../../shared/types'

/** Шаблоны модов трейда (/api/trade/data/stats): "+#% to Fire Resistance" → id. Кэш на диске на сутки. */
interface Entry {
  id: string
  re: RegExp
  local: boolean
}

const file = () => join(app.getPath('userData'), 'trade-stats.json')
let index: Map<string, Entry[]> | null = null
let loading: Promise<void> | null = null

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function build(json: { result: { id: string; entries: { id: string; text: string; option?: unknown }[] }[] }) {
  const map = new Map<string, Entry[]>()
  for (const g of json.result) {
    const list: Entry[] = []
    for (const e of g.entries) {
      if (e.option) continue // моды с выбором из списка (например, notable) пока не поддерживаем
      const local = / \(Local\)$/.test(e.text)
      const text = e.text.replace(/ \(Local\)$/, '')
      if (text.includes('\n')) continue
      const re = new RegExp('^' + esc(text).replace(/#/g, '([+-]?\\d+(?:\\.\\d+)?)') + '$')
      list.push({ id: e.id, re, local })
    }
    map.set(g.id, list)
  }
  index = map
}

export async function ensureStats(): Promise<void> {
  if (index) return
  if (loading) return loading
  loading = (async () => {
    const f = file()
    const fresh = existsSync(f) && Date.now() - statSync(f).mtimeMs < 24 * 3600 * 1000
    let text: string
    if (fresh) text = readFileSync(f, 'utf-8')
    else {
      const res = await fetch('https://www.pathofexile.com/api/trade/data/stats', { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (!res.ok) {
        if (existsSync(f)) text = readFileSync(f, 'utf-8')
        else throw new Error(`trade stats: HTTP ${res.status}`)
      } else {
        text = await res.text()
        writeFileSync(f, text, 'utf-8')
      }
    }
    build(JSON.parse(text))
  })().finally(() => (loading = null))
  return loading
}

const GROUP: Record<ModKind, string[]> = {
  explicit: ['explicit'],
  crafted: ['crafted', 'explicit'],
  fractured: ['fractured', 'explicit'],
  implicit: ['implicit'],
  enchant: ['enchant']
}

/** Находит фильтр трейда для строки мода. Числа из строки усредняются, как это делает трейд ("Adds 10 to 20" → 15). */
export function matchStat(text: string, kind: ModKind, preferLocal: boolean): { id: string; value: number | null } | null {
  if (!index) return null
  for (const g of GROUP[kind]) {
    const hits: { e: Entry; m: RegExpMatchArray }[] = []
    for (const e of index.get(g) ?? []) {
      const m = text.match(e.re)
      if (m) hits.push({ e, m })
    }
    if (!hits.length) continue
    hits.sort((a, b) => Number(b.e.local === preferLocal) - Number(a.e.local === preferLocal))
    const { e, m } = hits[0]
    const nums = m.slice(1).map(Number).filter((n) => Number.isFinite(n))
    return { id: e.id, value: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null }
  }
  return null
}
