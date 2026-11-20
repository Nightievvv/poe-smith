import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UniqueCandidate } from '../../shared/types'
import { USER_AGENT } from '../leagues'

/**
 * Справочник предметов трейда (/api/trade/data/items): уникальные предметы по базам и камни
 * (у transfigured-камней поиск идёт по базовому камню с discriminator). Кэш на 7 дней.
 */
const URL_ITEMS = 'https://www.pathofexile.com/api/trade/data/items'
const file = () => join(app.getPath('userData'), 'trade-items.json')

type Entry = { name?: string; type: string; text?: string; disc?: string; flags?: { unique?: boolean } }
let data: { uniques: Entry[]; gems: Entry[] } | null = null

async function load() {
  if (data) return data
  let raw: any = null
  const f = file()
  if (existsSync(f) && Date.now() - statSync(f).mtimeMs < 7 * 24 * 3600 * 1000) raw = JSON.parse(readFileSync(f, 'utf-8'))
  else {
    try {
      const res = await fetch(URL_ITEMS, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.ok) {
        raw = await res.json()
        mkdirSync(app.getPath('userData'), { recursive: true })
        writeFileSync(f, JSON.stringify(raw), 'utf-8')
      }
    } catch {
      /* офлайн — старый файл */
    }
    if (!raw && existsSync(f)) raw = JSON.parse(readFileSync(f, 'utf-8'))
  }
  const all: Entry[] = (raw?.result ?? []).flatMap((g: { entries?: Entry[] }) => g.entries ?? [])
  data = { uniques: all.filter((e) => e.flags?.unique && e.name), gems: (raw?.result ?? []).find((g: { id: string }) => g.id === 'gem')?.entries ?? [] }
  return data
}

/** Тип камня для поиска: обычный — по названию, transfigured — базовый камень + discriminator. */
export async function gemType(name: string): Promise<{ option: string; discriminator?: string; transfigured: boolean }> {
  const d = await load().catch(() => null)
  const e = d?.gems.find((g) => g.disc && g.text === name)
  return e ? { option: e.type, discriminator: e.disc, transfigured: true } : { option: name, transfigured: false }
}

// ---------- кандидаты для неопознанного уникального предмета ----------
const NINJA_TYPES = ['UniqueFlask', 'UniqueArmour', 'UniqueWeapon', 'UniqueAccessory', 'UniqueJewel', 'UniqueMap']
const ninjaCache = new Map<string, { at: number; lines: { name: string; baseType: string; icon?: string; chaosValue: number; links?: number; variant?: string }[] }>()
const iconMemo = new Map<string, string>()

async function ninjaUniques(league: string) {
  const hit = ninjaCache.get(league)
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.lines
  const lines = (
    await Promise.all(
      NINJA_TYPES.map(async (t) => {
        try {
          const res = await fetch(`https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${t}`, { headers: { 'User-Agent': USER_AGENT } })
          return res.ok ? ((await res.json()).lines ?? []) : []
        } catch {
          return []
        }
      })
    )
  ).flat()
  ninjaCache.set(league, { at: Date.now(), lines })
  return lines
}

async function iconData(url: string): Promise<string | undefined> {
  if (iconMemo.has(url)) return iconMemo.get(url)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return undefined
    const v = 'data:image/png;base64,' + Buffer.from(await res.arrayBuffer()).toString('base64')
    iconMemo.set(url, v)
    return v
  } catch {
    return undefined
  }
}

/** Уникальные предметы этой базы: название, иконка и цена poe.ninja (без 6-линков и особых вариантов). */
export async function uniqueCandidates(league: string, baseType: string): Promise<UniqueCandidate[]> {
  const [d, lines] = await Promise.all([load().catch(() => null), ninjaUniques(league)])
  const names = new Set<string>((d?.uniques ?? []).filter((u) => u.type === baseType).map((u) => u.name!))
  for (const l of lines) if (l.baseType === baseType) names.add(l.name)
  const out: UniqueCandidate[] = []
  for (const name of names) {
    const ls = lines.filter((l) => l.name === name && l.baseType === baseType)
    const main = ls.find((l) => !l.links && !l.variant) ?? ls[0]
    out.push({ name, chaos: main?.chaosValue ?? null, icon: main?.icon ? await iconData(main.icon) : undefined })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
