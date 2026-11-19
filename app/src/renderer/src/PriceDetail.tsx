import type { ProfileResult } from '../../shared/types'
import type { T } from './i18n'
import { fmtPrice } from './format'

/** Гистограмма цен (лог-шкала) + квартили + ссылка на трейд. */
export function PriceDetail({ r, t, divine, title }: { r: ProfileResult; t: T; divine?: number; title?: string }) {
  if (r.error) return <p className="note warn">{t('market.profileError', { err: r.error })}</p>
  if (!r.values.length) return <p className="note">{t('market.noData')}</p>

  const W = 400, H = 110, P = 20, BINS = 16
  const min = r.values[0], max = r.values[r.values.length - 1]
  const lmin = Math.log(min), lmax = Math.log(max === min ? min * 1.5 : max)
  const bw = (lmax - lmin) / BINS
  const inside = new Array(BINS).fill(0), outside = new Array(BINS).fill(0)
  for (const v of r.values) {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor((Math.log(v) - lmin) / bw)))
    if (v < r.lo || v > r.hi) outside[b]++
    else inside[b]++
  }
  const top = Math.max(1, ...inside.map((c, i) => c + outside[i]))
  const x = (v: number) => P + ((Math.log(v) - lmin) / (lmax - lmin)) * (W - 2 * P)
  const barW = (W - 2 * P) / BINS - 1
  const mx = x(r.median || min)

  return (
    <div className="detail">
      <div className="detail-head">
        <span className="iname">{title}</span>
        <span className="muted small">{t('market.hist')}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('market.hist')}>
        <line x1={P} y1={H - 18} x2={W - P} y2={H - 18} stroke="var(--line)" />
        {inside.map((c, i) => {
          const bx = P + (i * (W - 2 * P)) / BINS
          const h1 = (c / top) * (H - 34), h2 = (outside[i] / top) * (H - 34)
          return (
            <g key={i}>
              {c > 0 && <rect x={bx} y={H - 18 - h1} width={barW} height={h1} fill="var(--brass)" />}
              {outside[i] > 0 && <rect x={bx} y={H - 18 - h1 - h2} width={barW} height={h2} fill="var(--bad)" opacity={0.6} />}
            </g>
          )
        })}
        {r.median > 0 && (
          <>
            <line x1={mx} y1={12} x2={mx} y2={H - 18} stroke="var(--fg)" strokeDasharray="3 3" />
            <text x={mx} y={9} fill="var(--fg)" fontSize="10" textAnchor="middle" fontFamily="Consolas, monospace">
              {fmtPrice(r.median, divine)}
            </text>
          </>
        )}
        <text x={P} y={H - 4} fill="var(--muted)" fontSize="10" fontFamily="Consolas, monospace">{fmtPrice(min, divine)}</text>
        <text x={W - P} y={H - 4} fill="var(--muted)" fontSize="10" textAnchor="end" fontFamily="Consolas, monospace">{fmtPrice(max, divine)}</text>
      </svg>
      <div className="legend">
        <span><i className="sw" style={{ background: 'var(--brass)' }} />{t('market.kept', { n: r.kept })}</span>
        <span><i className="sw" style={{ background: 'var(--bad)', opacity: 0.6 }} />{t('market.cut', { n: r.cut })}</span>
      </div>
      <div className="stats">
        <div><b>{fmtPrice(r.q1, divine)}</b><span>{t('market.q1')}</span></div>
        <div><b>{fmtPrice(r.median, divine)}</b><span>{t('market.median')}</span></div>
        <div><b>{fmtPrice(r.q3, divine)}</b><span>{t('market.q3')}</span></div>
        <div><b>{r.sellers}</b><span>{t('market.sellers')}</span></div>
      </div>
      <div className="detail-foot">
        <span className="muted small">{t('market.fresh', { p: Math.round(r.fresh * 100) })}</span>
        {r.tradeUrl && <a href={r.tradeUrl} target="_blank" rel="noreferrer">{t('market.openTrade')}</a>}
      </div>
    </div>
  )
}
