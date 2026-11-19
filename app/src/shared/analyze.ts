import type { OutlierMode } from './types'

export interface PricePoint {
  /** цена в Divine */
  div: number
  account: string
  indexed: string
}

export interface PriceStats {
  /** все цены после схлопывания продавцов (по одной на аккаунт), по возрастанию */
  values: number[]
  lo: number
  hi: number
  median: number
  q1: number
  q3: number
  kept: number
  cut: number
  sellers: number
  /** доля лотов, выставленных за последние 24 часа */
  fresh: number
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/**
 * 1. Один продавец = одна цена (берём его минимальную): массовые лоты одного аккаунта не перекашивают выборку.
 * 2. Выбросы отсекаем по межквартильному размаху или перцентилям, плюс всё, что дешевле 1/10 медианы.
 * 3. Медиана того, что осталось, — «рыночная цена».
 */
export function analyze(points: PricePoint[], mode: OutlierMode, now = Date.now()): PriceStats {
  const byAccount = new Map<string, PricePoint>()
  for (const p of points) {
    const prev = byAccount.get(p.account)
    if (!prev || p.div < prev.div) byAccount.set(p.account, p)
  }
  const uniq = [...byAccount.values()]
  const values = uniq.map((p) => p.div).sort((a, b) => a - b)
  let lo = values[0] ?? 0
  let hi = values[values.length - 1] ?? 0
  if (values.length >= 5) {
    if (mode === 'p10-90') {
      lo = quantile(values, 0.1)
      hi = quantile(values, 0.9)
    } else {
      const k = mode === 'iqr3' ? 3 : 1.5
      const q1 = quantile(values, 0.25)
      const q3 = quantile(values, 0.75)
      const iqr = q3 - q1
      lo = Math.max(0, q1 - k * iqr)
      hi = q3 + k * iqr
    }
    // «приманки» (цены в 10+ раз ниже медианы) при большом разбросе IQR не ловит — отсекаем явно
    lo = Math.max(lo, quantile(values, 0.5) / 10)
  }
  const kept = values.filter((v) => v >= lo && v <= hi)
  const fresh = uniq.length ? uniq.filter((p) => now - Date.parse(p.indexed) < 24 * 3600 * 1000).length / uniq.length : 0
  return {
    values,
    lo,
    hi,
    median: quantile(kept, 0.5),
    q1: quantile(kept, 0.25),
    q3: quantile(kept, 0.75),
    kept: kept.length,
    cut: values.length - kept.length,
    sellers: uniq.length,
    fresh
  }
}
