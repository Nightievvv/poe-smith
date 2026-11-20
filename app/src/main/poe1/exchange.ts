import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ExchangeData, ExchangeItem } from '../../shared/types'
import { USER_AGENT } from '../leagues'

/**
 * Биржа валют (Currency Exchange) по данным poe.ninja: цена в Chaos, тренд за 7 дней, объём за час, иконка.
 * Категории — те, что poe.ninja показывает на бирже PoE 1 (у каждой лиги набор может отличаться: пустые просто пропускаются).
 */
export const EXCHANGE_TYPES = ['Currency', 'Fragment', 'Essence', 'Fossil', 'Resonator', 'DeliriumOrb', 'Oil', 'Omen', 'Scarab', 'Tattoo', 'Artifact', 'Runegraft', 'Thread', 'Astrolabe'] as const

const ICON_HOST = 'https://web.poecdn.com'
const cache = new Map<string, ExchangeData>()
const pending = new Map<string, Promise<ExchangeData>>()

type Raw = {
  lines: { id: string; primaryValue: number; volumePrimaryValue?: number; sparkline?: { totalChange?: number; data?: (number | null)[] } }[]
  items?: { id: string; name: string; image?: string; category?: string }[]
}

async function loadType(league: string, type: string): Promise<ExchangeItem[]> {
  const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
  if (!res.ok) return []
  const j = (await res.json()) as Raw
  const meta = new Map((j.items ?? []).map((i) => [i.id, i]))
  const out: ExchangeItem[] = []
  for (const l of j.lines ?? []) {
    const m = meta.get(l.id)
    if (!m || !(l.primaryValue > 0)) continue
    out.push({
      id: l.id,
      name: m.name,
      type,
      category: m.category ?? type,
      chaos: l.primaryValue,
      volume: l.volumePrimaryValue ?? 0,
      change: l.sparkline?.totalChange ?? null,
      spark: (l.sparkline?.data ?? []).map((v) => (typeof v === 'number' ? v : null)),
      image: m.image ?? ''
    })
  }
  return out
}

/** Все категории биржи для лиги; кэш на 15 минут. */
export async function exchangeData(league: string, force = false): Promise<ExchangeData> {
  const hit = cache.get(league)
  if (hit && !force && Date.now() - hit.at < 15 * 60 * 1000) return hit
  if (pending.has(league)) return pending.get(league)!
  const p = (async () => {
    const parts = await Promise.all(EXCHANGE_TYPES.map((t) => loadType(league, t).catch(() => [] as ExchangeItem[])))
    const items = parts.flat()
    const divine = items.find((i) => i.id === 'divine')?.chaos ?? hit?.divine ?? 0
    if (!items.length && hit) return hit
    if (!items.length) throw new Error('poe.ninja: нет данных биржи')
    const data: ExchangeData = { league, divine, items, at: Date.now() }
    cache.set(league, data)
    return data
  })().finally(() => pending.delete(league))
  pending.set(league, p)
  return p
}

// ---------- иконки poe.ninja (картинки с web.poecdn.com), кэш на диске ----------
const iconDir = () => join(app.getPath('userData'), 'ninja-icons')
const iconMemo = new Map<string, string>()
const safe = (id: string) => id.replace(/[^a-z0-9-]/gi, '_')

async function iconOf(item: ExchangeItem): Promise<string | null> {
  if (iconMemo.has(item.id)) return iconMemo.get(item.id)!
  if (!item.image) return null
  mkdirSync(iconDir(), { recursive: true })
  // имя файла — по пути картинки: при смене арта у GGG качаем заново
  const file = join(iconDir(), safe(item.id) + '-' + safe(item.image.split('/').slice(-2, -1)[0] ?? '') + '.png')
  let buf: Buffer | null = existsSync(file) ? readFileSync(file) : null
  if (!buf) {
    try {
      const res = await fetch(item.image.startsWith('http') ? item.image : ICON_HOST + item.image, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(file, buf)
      }
    } catch {
      /* нет сети — без иконки */
    }
  }
  if (!buf) return null
  const v = 'data:image/png;base64,' + buf.toString('base64')
  iconMemo.set(item.id, v)
  return v
}

/** Иконки предметов биржи (data URL) по id. */
export async function exchangeIcons(league: string, ids?: string[]): Promise<Record<string, string>> {
  const data = await exchangeData(league)
  const want = ids ? new Set(ids) : null
  const list = data.items.filter((i) => !want || want.has(i.id))
  const out: Record<string, string> = {}
  const q = [...list]
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (q.length) {
        const it = q.shift()!
        const v = await iconOf(it).catch(() => null)
        if (v) out[it.id] = v
      }
    })
  )
  return out
}
