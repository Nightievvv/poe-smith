import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CraftDataStatus } from '../../shared/types'
import { USER_AGENT } from '../leagues'

/**
 * Данные игры из RePoE (https://repoe-fork.github.io) — выгрузка файлов клиента PoE 1:
 * все моды с весами по тегам баз, базы, эссенции, крафты верстака. ~27 МБ, качаются один раз и обновляются,
 * когда меняется версия игры.
 */
const BASE = 'https://repoe-fork.github.io/'
const FILES = ['mods.min.json', 'base_items.min.json', 'essences.min.json', 'crafting_bench_options.min.json', 'fossils.min.json'] as const

export interface Fossil {
  name: string
  /** тег мода → множитель веса (×10 = 1000/100; 0 — такие моды не выпадут) */
  weights: { tag: string; mult: number }[]
}

export interface Mod {
  id: string
  name: string
  gen: string
  domain: string
  type: string
  text: string
  reqLevel: number
  weights: { tag: string; weight: number }[]
  tags: string[]
  /** регулярки для каждой строки текста + границы чисел */
  lines: { re: RegExp; ranges: [number, number][] }[]
}

export interface Base {
  id: string
  name: string
  itemClass: string
  domain: string
  tags: string[]
  implicits: string[]
  dropLevel: number
}

export interface Essence {
  id: string
  name: string
  level: number
  /** класс предмета → id мода */
  mods: Record<string, string>
}

export interface BenchCraft {
  modId: string
  itemClasses: string[]
  cost: { name: string; count: number }[]
}

export interface CraftData {
  version: string
  mods: Map<string, Mod>
  /** у одной базы может быть несколько вариантов с разными имплиситами (например, Two-Toned Boots) */
  bases: Map<string, Base[]>
  essences: Essence[]
  bench: BenchCraft[]
  fossils: Fossil[]
}

const dir = () => join(app.getPath('userData'), 'repoe')
let data: CraftData | null = null
let status: CraftDataStatus = { ready: false, loading: false }
let loading: Promise<CraftData> | null = null
const listeners = new Set<(s: CraftDataStatus) => void>()

export const craftStatus = () => status
export const onCraftStatus = (cb: (s: CraftDataStatus) => void) => listeners.add(cb)
function setStatus(s: CraftDataStatus) {
  status = s
  listeners.forEach((cb) => cb(s))
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NUM = '([+-]?\\d+(?:\\.\\d+)?)'

/** "+(10-24) to maximum Life" → /^\+(\d+) to maximum Life$/ c диапазоном [10, 24]. */
function compileLine(line: string) {
  const ranges: [number, number][] = []
  let src = ''
  const re = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    src += esc(line.slice(last, m.index))
    if (m[1] != null) ranges.push([Number(m[1]), Number(m[2])])
    else ranges.push([Number(m[3]), Number(m[3])])
    src += NUM
    last = m.index + m[0].length
  }
  src += esc(line.slice(last))
  return { re: new RegExp('^' + src + '$'), ranges }
}

async function download(name: string) {
  const res = await fetch(BASE + name, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`RePoE ${name}: HTTP ${res.status}`)
  writeFileSync(join(dir(), name), await res.text(), 'utf-8')
}

const KEEP_GEN = new Set(['prefix', 'suffix', 'searing_exarch_implicit', 'eater_of_worlds_implicit', 'corrupted', 'essence'])
const KEEP_DOMAIN = new Set(['item', 'jewel', 'abyss_jewel', 'flask', 'crafted', 'misc'])

function build(version: string): CraftData {
  const read = (n: string) => JSON.parse(readFileSync(join(dir(), n), 'utf-8'))
  const rawBases = read('base_items.min.json') as Record<string, any>
  const bases = new Map<string, Base[]>()
  const currencyName = new Map<string, string>()
  for (const [id, b] of Object.entries(rawBases)) {
    if (id.includes('/Currency/')) currencyName.set(id, b.name)
    if (b.release_state !== 'released' || !b.name) continue
    const v = { id, name: b.name, itemClass: b.item_class, domain: b.domain, tags: b.tags ?? [], implicits: b.implicits ?? [], dropLevel: b.drop_level ?? 1 }
    bases.set(b.name, [...(bases.get(b.name) ?? []), v])
  }
  const rawMods = read('mods.min.json') as Record<string, any>
  const mods = new Map<string, Mod>()
  for (const [id, m] of Object.entries(rawMods)) {
    if (!KEEP_GEN.has(m.generation_type) && m.domain !== 'crafted') continue
    if (!KEEP_DOMAIN.has(m.domain) || !m.text) continue
    mods.set(id, {
      id, name: m.name ?? '', gen: m.generation_type, domain: m.domain, type: m.type, text: m.text, reqLevel: m.required_level ?? 1,
      weights: m.spawn_weights ?? [], tags: m.implicit_tags ?? [],
      lines: String(m.text).split('\n').map(compileLine)
    })
  }
  // имплиситы баз (тип "unique"/"implicit" отфильтрованы выше) — добавляем отдельно
  for (const b of [...bases.values()].flat())
    for (const iid of b.implicits) {
      const m = rawMods[iid]
      if (m?.text && !mods.has(iid))
        mods.set(iid, { id: iid, name: '', gen: 'base_implicit', domain: m.domain, type: m.type, text: m.text, reqLevel: m.required_level ?? 1, weights: [], tags: [], lines: String(m.text).split('\n').map(compileLine) })
    }
  const rawEss = read('essences.min.json') as Record<string, any>
  const essences: Essence[] = Object.entries(rawEss)
    .filter(([, e]) => e.mods && Object.keys(e.mods).length)
    .map(([id, e]) => ({ id, name: rawBases[id]?.name ?? id.split('/').pop()!, level: e.level ?? 0, mods: e.mods }))
  const rawBench = read('crafting_bench_options.min.json') as any[]
  const bench: BenchCraft[] = rawBench
    .filter((b) => b.actions?.add_explicit_mod)
    .map((b) => ({
      modId: b.actions.add_explicit_mod,
      itemClasses: b.item_classes ?? [],
      cost: Object.entries(b.cost ?? {}).map(([cid, n]) => ({ name: currencyName.get(cid) ?? cid.split('/').pop()!, count: n as number }))
    }))
  // моды верстака лежат в mods.json с domain crafted — уже загружены
  const rawFos = read('fossils.min.json') as Record<string, any>
  const fossils: Fossil[] = Object.values(rawFos)
    .filter((f) => f.name && ((f.positive_mod_weights?.length ?? 0) > 0 || (f.negative_mod_weights?.length ?? 0) > 0))
    .map((f) => ({
      name: f.name,
      weights: [...(f.positive_mod_weights ?? []), ...(f.negative_mod_weights ?? [])].map((w: { tag: string; weight: number }) => ({ tag: w.tag, mult: w.weight / 100 }))
    }))
  return { version, mods, bases, essences, bench, fossils }
}

export async function loadCraftData(): Promise<CraftData> {
  if (data) return data
  if (loading) return loading
  loading = (async () => {
    setStatus({ ready: false, loading: true })
    try {
      mkdirSync(dir(), { recursive: true })
      const verFile = join(dir(), 'version.txt')
      let local = existsSync(verFile) ? readFileSync(verFile, 'utf-8').trim() : ''
      const stale = !local || Date.now() - statSync(verFile).mtimeMs > 24 * 3600 * 1000
      let remote = local
      if (stale) {
        try {
          const r = await fetch(BASE + 'version.txt', { headers: { 'User-Agent': USER_AGENT } })
          if (r.ok) remote = (await r.text()).trim()
        } catch {
          /* офлайн — работаем со старыми данными */
        }
      }
      const missing = FILES.some((f) => !existsSync(join(dir(), f)))
      if (missing || (remote && remote !== local)) {
        for (const f of FILES) await download(f)
        local = remote || 'unknown'
      }
      writeFileSync(verFile, local, 'utf-8')
      data = build(local)
      setStatus({ ready: true, loading: false, version: local })
      return data
    } catch (e) {
      setStatus({ ready: false, loading: false, error: e instanceof Error ? e.message : String(e) })
      throw e
    } finally {
      loading = null
    }
  })()
  return loading
}

/** Вес мода для базы: первый тег из spawn_weights, который есть у базы (так считает игра). */
export function weightFor(mod: Mod, tags: string[]): number {
  for (const w of mod.weights) if (tags.includes(w.tag)) return w.weight
  return 0
}

/** Сопоставление строки мода с модом игры: текст совпал и числа попали в диапазоны. */
export function matchMod(mod: Mod, lines: string[]): boolean {
  if (lines.length !== mod.lines.length && mod.lines.length > 1 && lines.length === 1) {
    // гибридный мод: проверяем, что строка совпадает с одной из его строк
    return mod.lines.some((l) => lineFits(l, lines[0]))
  }
  return lines.every((t, i) => lineFits(mod.lines[i] ?? mod.lines[0], t))
}

/** Совпадение только по тексту, без проверки чисел (для имплиситов баз: их значения меняются между патчами). */
export function matchModText(mod: Mod, text: string): boolean {
  return mod.lines.some((l) => l.re.test(text))
}

function lineFits(l: Mod['lines'][number], text: string): boolean {
  const m = text.match(l.re)
  if (!m) return false
  const vals = m.slice(1).map(Number)
  return vals.every((v, i) => {
    const r = l.ranges[i]
    if (!r) return true
    const [a, b] = r[0] <= r[1] ? r : [r[1], r[0]]
    return Math.abs(v) >= Math.abs(a) - 0.001 && Math.abs(v) <= Math.abs(b) + 0.001
  })
}
