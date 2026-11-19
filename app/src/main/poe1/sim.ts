/**
 * Монте-Карло симуляция роллов предмета: моды выбираются по весам без возвращения, как в игре —
 * не больше одного мода из группы и не больше maxSide префиксов/суффиксов.
 * Результат — маска нужных модов для каждого ролла; по маскам считаются любые вероятности.
 */
export interface SimMod {
  type: string
  gen: 'prefix' | 'suffix'
  reqLevel: number
  groups: string[]
  w: number
}

export interface SimTarget {
  type: string
  gen: 'prefix' | 'suffix'
  reqLevel: number
}

export interface SimOptions {
  /** число модов на предмете и вероятность: редкий — 4/5/6, магический — 1/2 */
  counts: [number, number][]
  maxSide: number
  /** моды, которые точно будут (эссенция) */
  forced?: SimMod[]
  /** один мод гарантированно из этого пула (Harvest «including a … modifier») */
  forcedFrom?: SimMod[]
  n?: number
}

export const RARE_COUNTS: [number, number][] = [[4, 8 / 12], [5, 3 / 12], [6, 1 / 12]]
export const JEWEL_COUNTS: [number, number][] = [[3, 0.5], [4, 0.5]]
export const MAGIC_COUNTS: [number, number][] = [[1, 0.5], [2, 0.5]]

// детерминированный генератор, чтобы план не «прыгал» между построениями
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fits = (m: SimMod, t: SimTarget) => m.type === t.type && m.gen === t.gen && m.reqLevel >= t.reqLevel

export function simulate(pool: SimMod[], targets: SimTarget[], o: SimOptions): Uint32Array {
  const n = o.n ?? 20000
  const rand = rng(0x5eed + pool.length * 31 + targets.length)
  const masks = new Uint32Array(n)
  const bitOf = (m: SimMod) => targets.reduce((acc, t, i) => (fits(m, t) ? acc | (1 << i) : acc), 0)
  const poolBits = pool.map(bitOf)
  const fromBits = (o.forcedFrom ?? []).map(bitOf)
  const forcedBits = (o.forced ?? []).map(bitOf)
  const taken = new Uint8Array(pool.length)

  const pickCount = () => {
    let r = rand()
    for (const [k, p] of o.counts) { if ((r -= p) <= 0) return k }
    return o.counts[o.counts.length - 1][0]
  }

  for (let s = 0; s < n; s++) {
    taken.fill(0)
    const groups = new Set<string>()
    const side = { prefix: 0, suffix: 0 }
    let mask = 0
    let count = 0
    const add = (m: SimMod, bits: number) => {
      m.groups.forEach((g) => groups.add(g))
      side[m.gen]++
      mask |= bits
      count++
    }
    ;(o.forced ?? []).forEach((m, i) => add(m, forcedBits[i]))
    if (o.forcedFrom?.length) {
      let total = 0
      for (const m of o.forcedFrom) total += m.w
      let r = rand() * total
      for (let i = 0; i < o.forcedFrom.length; i++) {
        if ((r -= o.forcedFrom[i].w) <= 0) { add(o.forcedFrom[i], fromBits[i]); break }
      }
    }
    const want = Math.max(count, pickCount())
    while (count < want) {
      let total = 0
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i]
        if (taken[i] || side[m.gen] >= o.maxSide || m.groups.some((g) => groups.has(g))) continue
        total += m.w
      }
      if (total <= 0) break
      let r = rand() * total
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i]
        if (taken[i] || side[m.gen] >= o.maxSide || m.groups.some((g) => groups.has(g))) continue
        if ((r -= m.w) <= 0) { taken[i] = 1; add(m, poolBits[i]); break }
      }
    }
    masks[s] = mask
  }
  return masks
}

/** Доля роллов, где есть все биты `all` и хотя бы один из `any` (если задан). */
export function prob(masks: Uint32Array, all: number, any = 0): number {
  let hit = 0
  for (let i = 0; i < masks.length; i++) {
    const m = masks[i]
    if ((m & all) === all && (any === 0 || (m & any) !== 0)) hit++
  }
  return hit / masks.length
}
