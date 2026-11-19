import { useEffect, useMemo, useState } from 'react'
import type { ExampleItem, FavoriteProfile, Lang, MarketQuery, SlotId, SlotMarket } from '../../shared/types'
import { SUBTYPES } from '../../shared/poe1/catalog'
import type { T } from './i18n'
import { SlotSelect } from './SlotSelect'
import { PriceDetail } from './PriceDetail'
import { Examples } from './Examples'
import { errText, fmtAgo, fmtPrice, fmtTotal } from './format'

type Sort = 'score' | 'price' | 'total'

interface Props {
  t: T
  lang: Lang
  query: MarketQuery
  setQuery: (q: MarketQuery) => void
  market: SlotMarket | null
  divine: number | null
  onExample: (e: ExampleItem) => void
  onReload: () => void
  favorites: FavoriteProfile[]
  setFavorites: (f: FavoriteProfile[]) => void
}

export function MarketTab({ t, lang, query, setQuery, market, divine: divineRate, onExample, onReload, favorites, setFavorites }: Props) {
  const favKey = (id: string) => (f: FavoriteProfile) => f.profileId === id && f.slot === query.slot && f.subtype === query.subtype
  const isFav = (id: string) => favorites.some(favKey(id))
  const toggleFav = (id: string, name: FavoriteProfile['name']) =>
    setFavorites(isFav(id) ? favorites.filter((f) => !favKey(id)(f))
      : [...favorites, { profileId: id, name, slot: query.slot, subtype: query.subtype, minValue: query.minValue, minCurrency: query.minCurrency }])
  const [sort, setSort] = useState<Sort>('score')
  const [sel, setSel] = useState<string | null>(null)
  // черновик отсечки: в запрос попадает только по «Найти» или Enter
  const [draft, setDraft] = useState(query.minValue ? String(query.minValue) : '')
  const [cur, setCur] = useState(query.minCurrency)

  useEffect(() => setSel(null), [query.slot, query.subtype])

  const divine = market?.divine ?? divineRate ?? undefined
  const draftNum = Number(draft.replace(',', '.')) || 0
  const converted =
    draftNum > 0 && divine
      ? cur === 'divine'
        ? `≈ ${Math.round(draftNum * divine)}c`
        : `≈ ${(draftNum / divine).toFixed(2)} div`
      : ''

  const find = (more = false) => {
    const q = { ...query, minValue: draftNum, minCurrency: cur }
    setQuery(q)
    window.api.scanMarket(q, more)
  }

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
  const subtypes = SUBTYPES[query.slot]
  const draftChanged = draftNum !== query.minValue || cur !== query.minCurrency
  const remaining = market ? market.totalProfiles - market.profiles.length : 0

  return (
    <>
      <div className="row">
        <SlotSelect id="m-slot" label={t('market.slot')} value={query.slot}
          onChange={(s: SlotId) => setQuery({ ...query, slot: s, subtype: SUBTYPES[s][0].id })} t={t} />
        <div className="field">
          <label htmlFor="m-sub">{t('market.subtype')}</label>
          <select id="m-sub" value={query.subtype} disabled={subtypes.length < 2}
            onChange={(e) => setQuery({ ...query, subtype: e.target.value })}>
            {subtypes.map((s) => <option key={s.id} value={s.id}>{s.name[lang]}</option>)}
          </select>
        </div>
      </div>

      <form className="row end" onSubmit={(e) => { e.preventDefault(); find() }}>
        <div className="field">
          <label htmlFor="m-min">{t('market.minPrice')}</label>
          <div className="row">
            <input id="m-min" type="text" inputMode="decimal" placeholder="0" value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))} />
            <select id="m-cur" aria-label={t('market.currency')} value={cur} onChange={(e) => setCur(e.target.value as 'chaos' | 'divine')} style={{ width: 'auto' }}>
              <option value="divine">div</option>
              <option value="chaos">chaos</option>
            </select>
          </div>
        </div>
        <button type="submit" className="btn primary" disabled={market?.scanning}>{t('market.find')}</button>
      </form>
      <p className="status small">
        {converted && <span className="mono">{converted} · </span>}
        {market?.scanning && market.progress
          ? t('market.scanning', market.progress)
          : market?.error
            ? errText(t, market.error)
            : draftChanged
              ? t('market.pressFind')
              : market?.scannedAt
                ? t('market.updated', { ago: fmtAgo(t, market.scannedAt), league: market.league, div: Math.round(divine ?? 0) })
                : t('market.never')}
      </p>

      {rows.length > 0 && (
        <>
          <div className="seg" role="group" aria-label={t('market.sort')}>
            {(['score', 'price', 'total'] as Sort[]).map((s) => (
              <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>{t(`market.sort.${s}`)}</button>
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
                      <div className="iname r-rare">
                        <button className={'ico inline fav' + (isFav(r.id) ? ' on' : '')} aria-pressed={isFav(r.id)}
                          aria-label={t('market.favorite')} title={t('market.favorite')}
                          onClick={(e) => { e.stopPropagation(); toggleFav(r.id, r.name) }}>{isFav(r.id) ? '★' : '☆'}</button>
                        {r.custom && <span className="mine" title={t('market.custom')}>✎</span>}
                        {r.name[lang]}
                        {r.custom && (
                          <button className="ico inline" aria-label={t('market.deleteProfile')} title={t('market.deleteProfile')}
                            onClick={async (e) => { e.stopPropagation(); await window.api.deleteProfile(r.id); onReload() }}>✕</button>
                        )}
                      </div>
                      {r.error && <div className="bad small">{errText(t, r.error)}</div>}
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
          {selected && (
            <button className="btn primary" disabled={!selected.r.craftItem}
              title={selected.r.craftItem ? undefined : t('market.noCraftItem')}
              onClick={() => selected.r.craftItem && onExample({ ...selected.r.craftItem, name: selected.r.name[lang], price: '', priceDiv: 0 })}>
              {t('market.craftProfile', { name: selected.r.name[lang] })}
            </button>
          )}
          {market?.hasMore && !market.scanning && remaining > 0 && (
            <button className="btn" onClick={() => find(true)}>
              {t('market.more', { n: Math.min(5, remaining), left: remaining })}
            </button>
          )}
          {selected && (
            <>
              <PriceDetail r={selected.r} t={t} divine={divine} title={selected.r.name[lang]} />
              <Examples items={selected.r.examples ?? []} t={t} divine={divine} onPick={onExample} />
            </>
          )}
          <p className="note">{t('market.note', { n: 20 })}</p>
        </>
      )}
    </>
  )
}
