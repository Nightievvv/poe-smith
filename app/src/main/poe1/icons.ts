import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CurrencyIcon } from '../../shared/types'
import { USER_AGENT } from '../leagues'

/**
 * Иконки валюты: список валют и путей к картинкам — из /api/trade/data/static (лимиты поиска не тратит),
 * сами картинки качаются один раз и лежат в %APPDATA%\PoESmith\currency-icons.
 */
const STATIC_URL = 'https://www.pathofexile.com/api/trade/data/static'
const HOST = 'https://www.pathofexile.com'
const dir = () => join(app.getPath('userData'), 'currency-icons')
const staticFile = () => join(dir(), 'static.json')

type Entry = { id: string; text: string; image?: string }
let entries: Map<string, Entry> | null = null
let loading: Promise<Map<string, Entry>> | null = null
const memo = new Map<string, CurrencyIcon | null>()

async function loadStatic(): Promise<Map<string, Entry>> {
  if (entries) return entries
  if (loading) return loading
  loading = (async () => {
    mkdirSync(dir(), { recursive: true })
    const f = staticFile()
    let raw: any = null
    const fresh = existsSync(f) && Date.now() - statSync(f).mtimeMs < 7 * 24 * 3600 * 1000
    if (fresh) raw = JSON.parse(readFileSync(f, 'utf-8'))
    else {
      try {
        const res = await fetch(STATIC_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
        if (res.ok) {
          raw = await res.json()
          writeFileSync(f, JSON.stringify(raw), 'utf-8')
        }
      } catch {
        /* офлайн — берём старый файл, если он есть */
      }
      if (!raw && existsSync(f)) raw = JSON.parse(readFileSync(f, 'utf-8'))
    }
    const m = new Map<string, Entry>()
    for (const g of raw?.result ?? []) for (const e of g.entries ?? []) if (e.id && e.image) m.set(e.id, e)
    entries = m
    return m
  })().finally(() => {
    loading = null
  })
  return loading
}

const safe = (id: string) => id.replace(/[^a-z0-9-]/gi, '_')

async function icon(id: string): Promise<CurrencyIcon | null> {
  if (memo.has(id)) return memo.get(id)!
  const e = (await loadStatic()).get(id)
  if (!e?.image) return null
  const file = join(dir(), safe(id) + '.png')
  let buf: Buffer | null = existsSync(file) ? readFileSync(file) : null
  if (!buf) {
    try {
      const res = await fetch(e.image.startsWith('http') ? e.image : HOST + e.image, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok) {
        buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(file, buf)
      }
    } catch {
      /* нет сети — покажем текст */
    }
  }
  const v = buf ? { src: 'data:image/png;base64,' + buf.toString('base64'), name: e.text } : null
  // неудачную загрузку не запоминаем — попробуем снова в следующий раз
  if (v) memo.set(id, v)
  return v
}

export async function currencyIcons(ids: string[]): Promise<Record<string, CurrencyIcon>> {
  const out: Record<string, CurrencyIcon> = {}
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const v = await icon(id).catch(() => null)
      if (v) out[id] = v
    })
  )
  return out
}
