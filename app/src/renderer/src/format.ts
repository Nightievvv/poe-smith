import type { T } from './i18n'

/** Цена: от 1 div — в Divine, дешевле — в Chaos. */
export function fmtPrice(div: number, chaosPerDiv?: number): string {
  if (!div) return '—'
  if (div >= 1 || !chaosPerDiv) return `${div >= 10 ? Math.round(div) : div.toFixed(1)} div`
  return `${Math.max(1, Math.round(div * chaosPerDiv))}c`
}

export function fmtAgo(t: T, ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return t('ago.now')
  if (m < 60) return t('ago.min', { n: m })
  if (m < 48 * 60) return t('ago.h', { n: Math.floor(m / 60) })
  return t('ago.d', { n: Math.floor(m / 1440) })
}

export const fmtTotal = (n: number) => (n >= 10000 ? '10000+' : String(n))
