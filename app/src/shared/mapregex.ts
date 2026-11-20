import type { MapModData, MapModInfo } from './types'

/**
 * Генератор regex для поиска карт в тайнике (как poe.re). В игре:
 *  - термы через пробел работают как И, «|» внутри терма — ИЛИ, «!» в начале терма — НЕ;
 *  - регистр не важен, длина строки — до 250 символов.
 * Для каждого выбранного мода подбираем самый короткий фрагмент его текста, который не встречается ни в чём,
 * кроме выбранных модов (совпадение с другим выбранным модом не мешает — так короче).
 */

export const REGEX_LIMIT = 250

/** Свойства карты, которые можно ограничить снизу (как в poe.re). */
export const MAP_YIELDS = [
  { id: 'drops', line: 'atlas drops: +#%' },
  { id: 'pack', line: 'monster pack size: +#%' },
  { id: 'maps', line: 'more maps: +#%' },
  { id: 'rarity', line: 'item rarity: +#%' },
  { id: 'currency', line: 'more currency: +#%' },
  { id: 'threads', line: 'more threads: +#%' },
  { id: 'div', line: 'more divination cards: +#%' }
] as const
export const MAP_QUALITY = [
  { id: 'q', line: 'quality: +#%' },
  { id: 'qpack', line: 'quality (pack size): +#%' },
  { id: 'qrarity', line: 'quality (rarity): +#%' },
  { id: 'qcurrency', line: 'quality (currency): +#%' },
  { id: 'qdiv', line: 'quality (divination cards): +#%' },
  { id: 'qthreads', line: 'quality (threads): +#%' }
] as const

export type Tri = 'any' | 'include' | 'exclude'

export interface MapRegexOptions {
  exclude: string[]
  want: string[]
  wantMode: 'any' | 'all'
  /** нижние границы свойств, % (0 — не ограничивать) */
  yields: Record<string, number>
  yieldMode: 'any' | 'all'
  quality: Record<string, number>
  qualityMode: 'any' | 'all'
  corrupted: Tri
  unidentified: Tri
  /** какие редкости оставить (пусто или все три — не фильтровать) */
  rarity: ('normal' | 'magic' | 'rare')[]
}

/** Регулярка «число ≥ n» для целых 1…999 (как у poe.re: 85 → (8[5-9]|9.|d..)). */
export function atLeast(n: number): string {
  n = Math.min(999, Math.max(0, Math.floor(n)))
  if (n <= 0) return String.raw`\d+`
  const s = String(n)
  const alts: string[] = []
  const range = (lo: number) => (lo === 9 ? '9' : lo === 0 ? '.' : `[${lo}-9]`)
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i])
    const last = i === s.length - 1
    if (last) alts.push(s.slice(0, i) + range(d))
    else if (d < 9) alts.push(s.slice(0, i) + range(d + 1) + '.'.repeat(s.length - i - 1))
  }
  // числа длиннее — все подходят
  if (s.length === 1) alts.push(String.raw`\d\d`)
  else if (s.length === 2) alts.push(String.raw`\d..`)
  return alts.length === 1 ? alts[0] : `(${alts.join('|')})`
}

/** Символы, которые можно брать во фрагмент без экранирования. */
const SAFE = /^[a-z0-9 ',:%-]+$/

class Matcher {
  private modText: string[]
  private corpus: string
  constructor(public data: MapModData) {
    this.modText = data.mods.map((m) => m.match.join('\n'))
    this.corpus = '\u0001' + data.corpus.join('\u0001') + '\u0001'
  }
  /** индексы модов, в тексте которых есть фрагмент; null — фрагмент встречается в общем тексте карт */
  hits(frag: string): number[] | null {
    if (this.corpus.includes(frag)) return null
    const out: number[] = []
    this.modText.forEach((t, i) => {
      if (t.includes(frag)) out.push(i)
    })
    return out
  }
  index(id: string) {
    return this.data.mods.findIndex((m) => m.id === id)
  }
}

const cache = new WeakMap<MapModData, Matcher>()
const matcher = (d: MapModData) => {
  let m = cache.get(d)
  if (!m) cache.set(d, (m = new Matcher(d)))
  return m
}

/**
 * Набор фрагментов, который покрывает все моды targets и не задевает моды вне allowed.
 * Жадно: на каждом шаге фрагмент с лучшим «покрыто новых модов / длина».
 */
function cover(m: Matcher, targets: number[], allowed: Set<number>): string[] | null {
  type Cand = { frag: string; set: number[] }
  const cands = new Map<string, Cand>()
  for (const t of targets) {
    const mod = m.data.mods[t]
    // моды, в которых целиком есть текст этого мода (например, T17-версия), неизбежно совпадут — их допускаем
    const sup = new Set(m.data.mods.map((x, j) => (mod.match.every((l) => x.match.includes(l)) ? j : -1)).filter((j) => j >= 0))
    const ok = (i: number) => allowed.has(i) || sup.has(i)
    for (const line of mod.match) {
      for (let a = 0; a < line.length; a++) {
        for (let len = 2; len <= 16 && a + len <= line.length; len++) {
          const frag = line.slice(a, a + len)
          if (!SAFE.test(frag)) break
          if (cands.has(frag)) break
          const h = m.hits(frag)
          if (!h || h.some((i) => !ok(i))) continue
          cands.set(frag, { frag, set: h })
          break // длиннее с того же места — не лучше
        }
      }
    }
  }
  const left = new Set(targets)
  const out: string[] = []
  while (left.size) {
    let best: Cand | null = null
    let score = -1
    for (const c of cands.values()) {
      const gain = c.set.filter((i) => left.has(i)).length
      if (!gain) continue
      const sc = gain / (c.frag.length + 1)
      if (sc > score || (sc === score && best && c.frag.length < best.frag.length)) {
        score = sc
        best = c
      }
    }
    if (!best) return null
    out.push(best.frag)
    best.set.forEach((i) => left.delete(i))
  }
  return out
}

/** Самый короткий фрагмент строки, которого нет ни в модах карт, ни в другом тексте карты (кроме самой строки). */
function uniqueOf(m: Matcher, line: string): string {
  const others = m.data.corpus.filter((c) => c !== line)
  const mods = m.data.mods.map((x) => x.match.join('\n'))
  for (let len = 2; len <= line.length; len++)
    for (let a = 0; a + len <= line.length; a++) {
      const f = line.slice(a, a + len)
      if (!/^[a-z0-9 ():,+-]+$/.test(f) || f.includes('#')) continue
      if (others.some((o) => o.includes(f)) || mods.some((o) => o.includes(f))) continue
      return f
    }
  return line.replace('#', '').trim()
}

const escape = (s: string) => s.replace(/[()+]/g, (c) => '\\' + c)
const quote = (s: string) => `"${s}"`

export interface MapRegexResult {
  regex: string
  /** моды, для которых не нашлось фрагмента без ложных совпадений */
  failed: string[]
}

export function buildMapRegex(data: MapModData, o: MapRegexOptions): MapRegexResult {
  const m = matcher(data)
  const terms: string[] = []
  const failed: string[] = []
  const idx = (ids: string[]) => ids.map((id) => m.index(id)).filter((i) => i >= 0)

  // исключения: один терм «!a|b|c»; фрагмент может задевать только исключаемые моды
  const ex = idx(o.exclude)
  if (ex.length) {
    const fr = cover(m, ex, new Set(ex))
    if (fr) terms.push(quote('!' + fr.join('|')))
    else failed.push(...o.exclude)
  }
  // нужные моды
  const want = idx(o.want)
  if (want.length) {
    if (o.wantMode === 'any') {
      const fr = cover(m, want, new Set(want))
      if (fr) terms.push(quote(fr.join('|')))
      else failed.push(...o.want)
    } else
      for (const i of want) {
        const fr = cover(m, [i], new Set([i]))
        if (fr) terms.push(quote(fr[0]))
        else failed.push(data.mods[i].id)
      }
  }
  // пороги свойств
  const thresholds = (list: readonly { id: string; line: string }[], vals: Record<string, number>, mode: 'any' | 'all') => {
    const parts = list.filter((y) => (vals[y.id] ?? 0) > 0).map((y) => `${escape(uniqueOf(m, y.line))}.*${atLeast(vals[y.id])}%`)
    if (!parts.length) return
    if (mode === 'any') terms.push(quote(parts.join('|')))
    else parts.forEach((p) => terms.push(quote(p)))
  }
  thresholds(MAP_YIELDS, o.yields, o.yieldMode)
  thresholds(MAP_QUALITY, o.quality, o.qualityMode)
  // состояние карты
  const tri = (v: Tri, line: string) => {
    if (v === 'any') return
    const f = uniqueOf(m, line)
    terms.push(quote((v === 'exclude' ? '!' : '') + f))
  }
  tri(o.corrupted, 'corrupted')
  tri(o.unidentified, 'unidentified')
  const rar = o.rarity.filter((r) => ['normal', 'magic', 'rare'].includes(r))
  if (rar.length && rar.length < 3) terms.push(quote(rar.map((r) => escape(uniqueOf(m, 'rarity: ' + r))).join('|')))
  return { regex: terms.join(' '), failed }
}

export const emptyMapRegex = (): MapRegexOptions => ({
  exclude: [], want: [], wantMode: 'any', yields: {}, yieldMode: 'all', quality: {}, qualityMode: 'any',
  corrupted: 'any', unidentified: 'any', rarity: []
})

export type { MapModInfo }
