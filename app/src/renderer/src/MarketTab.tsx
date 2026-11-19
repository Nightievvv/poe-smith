import { useEffect, useMemo, useState } from 'react'
import type { Lang, PriceCheck, SlotId, SlotMarket } from '../../shared/types'
import type { T } from './i18n'
import { SlotSelect } from './SlotSelect'
import { PriceDetail } from './PriceDetail'
import { ItemCard } from './ItemCard'
import { fmtAgo, fmtPrice, fmtTotal } from './format'

type Sort = 'score' | 'price' | 'total'

interface Props {
  t: T
  lang: Lang
  slot: SlotId
  setSlot: (s: SlotId) => void
  market: SlotMarket | null
  check: PriceCheck | null
  clearCheck: () => void
}

export function MarketTab({ t, lang, slot, setSlot, market, check, clearCheck }: Props) {
  const [sort, setSort] = useState<Sort>('score')
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => setSel(null), [slot])

  const rows = useMemo(() => {
    const list = market?.profiles ?? []
    const maxT = Math.max(1, ...list.map((r) => r.total))
    const withScore = list.map((r) => {
      const pop = r.total ? 0.6 * (Math.log10(r.total + 1) / Math.log10(maxT + 1)) + 0.4 * r.fresh : 0
      return { r, pop, score: pop * Math.log10(1 + r.median * 10) }
    })
    return withScore.sort((a, b) =>
      sort === 'price' ? b.r.median - a.r.median : sort === 'total' ? b.r.total - a.r.total : b.score - a.score
    )
  }, [market, sort])

  const selected = rows.find((x) => x.r.id === sel) ?? rows[0]
  const divine = market?.divine

  return (
    <>
      {check && (
        <div className="check">
          <ItemCard item={check.item} t={t} onClose={clearCheck} />
          {check.loading && <p className="note">{t('item.checking')}</p>}
          {check.error === 'unsupported' && <p className="note warn">{t('item.unsupported')}</p>}
          {check.error && check.error !== 'unsupported' && <p className="note warn">{t('market.profileError', { err: check.error })}</p>}
          {check.criteria.length > 0 && (
            <p className="muted small">{t('item.criteria')}: {check.criteria.join(' · ')}</p>
          )}
          {check.result && <PriceDetail r={check.result} t={t} divine={check.result.divine ?? divine} title={t('item.title')} />}
        </div>
      )}

      <div className="row end">
        <SlotSelect id="m-slot" label={t('market.slot')} value={slot} onChange={setSlot} t={t} />
        <button className="btn" disabled={market?.scanning} onClick={() => window.api.scanMarket(slot)}>
          {t('market.refresh')}
        </button>
      </div>

      <p className="status small">
        {market?.scanning && market.progress
          ? t('market.scanning', market.progress)
          : market?.error
            ? t('market.error', { err: market.error })
            : market?.scannedAt
              ? t('market.updated', { ago: fmtAgo(t, market.scannedAt), league: market.league, div: Math.round(divine ?? 0) })
              : t('market.never')}
      </p>

      {rows.length > 0 && (
        <>
          <div className="seg" role="group" aria-label={t('market.sort')}>
            {(['score', 'price', 'total'] as Sort[]).map((s) => (
              <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>
                {t(`market.sort.${s}`)}
              </button>
            ))}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('market.col.profile')}</th>
                  <th className="n">{t('market.col.median')}</th>
                  <th className="n">{t('market.col.total')}</th>
                  <th className="n">{t('market.col.trend')}</th>
                  <th>{t('market.col.demand')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, pop }) => (
                  <tr key={r.id} className={selected?.r.id === r.id ? 'sel' : ''} onClick={() => setSel(r.id)}>
                    <td>
                      <div className="iname r-rare">{r.name[lang]}</div>
                      {r.error && <div className="bad small">!</div>}
                    </td>
                    <td className="n">{fmtPrice(r.median, divine)}</td>
                    <td className="n">{fmtTotal(r.total)}</td>
                    <td className={'n ' + (r.trend == null ? 'muted' : r.trend > 0 ? 'up' : r.trend < 0 ? 'down' : '')}>
                      {r.trend == null ? '—' : `${r.trend > 0 ? '+' : ''}${r.trend}%`}
                    </td>
                    <td><span className="pop" style={{ width: Math.round(pop * 50) }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && <PriceDetail r={selected.r} t={t} divine={divine} title={selected.r.name[lang]} />}
          <p className="note">{t('market.note', { n: 20 })}</p>
        </>
      )}
    </>
  )
}
