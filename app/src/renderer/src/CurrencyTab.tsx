import { useEffect, useMemo, useState } from 'react'
import type { ExchangeData, ExchangeItem } from '../../shared/types'
import type { Key, T } from './i18n'
import { CurrencyAmount } from './Currency'

/** Вкладка «Валюта»: цены биржи poe.ninja как на poe.ninja/economy/…/currency — название, цена, тренд за 7 дней, объём в час. */
type Col = 'name' | 'price' | 'change' | 'volume'
const TYPES = ['Currency', 'Fragment', 'Essence', 'Fossil', 'Resonator', 'DeliriumOrb', 'Oil', 'Omen', 'Scarab', 'Tattoo', 'Artifact', 'Runegraft', 'Thread', 'Astrolabe']

export function CurrencyTab({ t }: { t: T }) {
  const [data, setData] = useState<ExchangeData | null>(null)
  const [error, setError] = useState('')
  const [type, setType] = useState('Currency')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ col: Col; desc: boolean }>({ col: 'price', desc: true })
  const [icons, setIcons] = useState<Record<string, string>>({})

  const load = (force = false) => {
    setError('')
    window.api.exchange(force).then(setData, (e) => setError(String(e?.message ?? e)))
  }
  useEffect(() => load(), [])

  const types = useMemo(() => TYPES.filter((ty) => data?.items.some((i) => i.type === ty)), [data])
  const list = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    const rows = data.items.filter((i) => i.type === type && (!s || i.name.toLowerCase().includes(s)))
    const key = (i: ExchangeItem): number | string =>
      sort.col === 'name' ? i.name.toLowerCase() : sort.col === 'price' ? i.chaos : sort.col === 'change' ? (i.change ?? -Infinity) : i.volume
    rows.sort((a, b) => {
      // при поиске сначала те, что начинаются с введённого текста
      if (s) {
        const pa = a.name.toLowerCase().startsWith(s), pb = b.name.toLowerCase().startsWith(s)
        if (pa !== pb) return pa ? -1 : 1
      }
      const ka = key(a), kb = key(b)
      const c = typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number)
      return sort.desc ? -c : c
    })
    return rows
  }, [data, type, q, sort])

  // иконки текущей категории
  useEffect(() => {
    if (!data) return
    const need = data.items.filter((i) => i.type === type && !icons[i.id]).map((i) => i.id)
    if (need.length) window.api.exchangeIcons(need).then((r) => setIcons((cur) => ({ ...cur, ...r })))
  }, [data, type])

  const head = (col: Col, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.col === col ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => setSort((s) => (s.col === col ? { col, desc: !s.desc } : { col, desc: col !== 'name' }))}>
        {label}
        <span className="sort-ind">{sort.col === col ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )

  return (
    <div className="cur-tab">
      <div className="row end">
        <div className="field">
          <label htmlFor="cur-q">{t('cur.search')}</label>
          <input id="cur-q" type="text" value={q} placeholder={t('cur.searchPh')} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
        {types.length > 1 && (
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="cur-type">{t('cur.category')}</label>
            <select id="cur-type" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`cur.type.${ty}` as Key)}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className="btn" onClick={() => load(true)} title={t('cur.reload')}>
          ⟳
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">{t('cur.loading')}</p>}
      {data && (
        <>
          <p className="muted small">
            {t('cur.source', { league: data.league, n: list.length })}
            {data.divine > 0 && (
              <>
                {' · '}
                <CurrencyAmount amount={1} id="divine" className="small" /> = <CurrencyAmount amount={Math.round(data.divine)} id="chaos" className="small" />
              </>
            )}
          </p>
          <table className="cur-table">
            <thead>
              <tr>
                {head('name', t('cur.col.name'))}
                {head('price', t('cur.col.price'), 'num')}
                {head('change', t('cur.col.change'), 'num')}
                {head('volume', t('cur.col.volume'), 'num')}
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td className="cur-name">
                    {icons[i.id] ? <img src={icons[i.id]} alt="" /> : <span className="cur-noimg" />}
                    <span>{i.name}</span>
                  </td>
                  <td className="num">
                    <PriceCell chaos={i.chaos} divine={data.divine} />
                  </td>
                  <td className="num">
                    <Trend item={i} />
                  </td>
                  <td className="num mono">{fmtVolume(i.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="muted">{t('cur.empty')}</p>}
        </>
      )}
    </div>
  )
}

function PriceCell({ chaos, divine }: { chaos: number; divine: number }) {
  // дешевле 2 Divine (и сам Divine) — в Chaos
  if (divine > 0 && chaos >= 2 * divine) return <CurrencyAmount amount={fmtNum(chaos / divine)} id="divine" className="small" />
  return <CurrencyAmount amount={fmtNum(chaos)} id="chaos" className="small" />
}

const fmtNum = (n: number) => (n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toPrecision(2))
const fmtVolume = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v)))

function Trend({ item }: { item: ExchangeItem }) {
  const pts = item.spark.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  const ch = item.change
  const cls = ch == null ? 'muted' : ch > 0 ? 'up' : ch < 0 ? 'down' : 'muted'
  let path = ''
  if (pts.length > 1) {
    const ys = pts.map((p) => p[1])
    const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1
    const n = Math.max(1, item.spark.length - 1)
    path = pts.map((p, k) => `${k ? 'L' : 'M'}${((p[0] / n) * 48).toFixed(1)},${(14 - ((p[1] - lo) / span) * 12).toFixed(1)}`).join(' ')
  }
  return (
    <span className={'trend ' + cls}>
      {path && (
        <svg width="50" height="16" viewBox="-1 0 50 16" aria-hidden="true">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
      <span className="mono">{ch == null ? '—' : `${ch > 0 ? '+' : ''}${Math.round(ch)}%`}</span>
    </span>
  )
}
