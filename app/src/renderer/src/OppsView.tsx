import { useEffect, useMemo, useState } from 'react'
import type { DiscoveredCombo, Lang, OppState, ParsedItem, Settings, SlotId } from '../../shared/types'
import { SlotSelect } from './SlotSelect'
import type { T } from './i18n'
import { CurrencyAmount } from './Currency'
import { fmtAgo } from './format'

/**
 * «Возможности»: что выгоднее всего крафтить. Для каждого профиля рынка — цена быстрой продажи, спрос
 * (сколько лотов уходит в день), стоимость лучшего плана (медиана симуляции с промахами и плохой расклад) и прибыль.
 * «В день» = прибыль × min(спрос, сколько крафтов вы успеваете).
 */
type Col = 'name' | 'sell' | 'cost' | 'profit' | 'sales' | 'day'

interface Props {
  t: T
  lang: Lang
  settings: Settings
  save: (patch: Partial<Settings>) => void
  onOpen: (item: ParsedItem) => void
}

/** Chaos → число и валюта: от 2 Divine — в Divine, дешевле — в Chaos. */
function Money({ chaos, divine, className }: { chaos: number; divine: number; className?: string }) {
  const neg = chaos < 0
  const a = Math.abs(chaos)
  const v = divine > 0 && a >= 2 * divine ? { n: (a / divine).toFixed(a >= 20 * divine ? 0 : 1), id: 'divine' } : { n: String(Math.round(a)), id: 'chaos' }
  return <CurrencyAmount amount={(neg ? '−' : '') + v.n} id={v.id} className={className} />
}

export function OppsView({ t, lang, settings, save, onOpen }: Props) {
  const [st, setSt] = useState<OppState | null>(null)
  const [sort, setSort] = useState<{ col: Col; desc: boolean }>({ col: 'day', desc: true })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.oppState().then(setSt)
    return window.api.onEvent((e) => {
      if (e.type === 'opps') setSt(e.data)
    })
  }, [])

  const cap = Math.max(1, settings.craftsPerDay || 1)
  const rows = useMemo(() => {
    const list = (st?.rows ?? []).map((r) => {
      const sellC = r.sellFast * r.divine
      const profit = r.cost != null ? sellC - r.cost : null
      const roi = profit != null && r.cost ? profit / r.cost : null
      const day = profit != null && r.sales != null ? profit * Math.min(r.sales, cap) : null
      return { r, sellC, profit, roi, day }
    })
    const key = (x: (typeof list)[number]): number | string =>
      sort.col === 'name' ? x.r.name[lang] : sort.col === 'sell' ? x.sellC : sort.col === 'cost' ? (x.r.cost ?? Infinity)
        : sort.col === 'profit' ? (x.profit ?? -Infinity) : sort.col === 'sales' ? (x.r.sales ?? -1) : (x.day ?? x.profit ?? -Infinity) - (x.day == null ? 1e12 : 0)
    return list.sort((a, b) => {
      const ka = key(a), kb = key(b)
      const c = typeof ka === 'string' ? ka.localeCompare(kb as string) : (ka as number) - (kb as number)
      return sort.desc ? -c : c
    })
  }, [st, sort, cap, lang])

  const head = (col: Col, label: string, hint?: string) => (
    <th className={col === 'name' ? '' : 'n'} title={hint} aria-sort={sort.col === col ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => setSort((s) => (s.col === col ? { col, desc: !s.desc } : { col, desc: col !== 'name' && col !== 'cost' }))}>
        {label}<span className="sort-ind">{sort.col === col ? (sort.desc ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )

  const scanned = st?.rows.length ?? 0
  const last = Math.max(0, ...(st?.rows ?? []).map((r) => r.scannedAt))

  return (
    <div className="opps">
      <p className="muted small">{t('opp.intro')}</p>
      <div className="row end opp-ctl">
        <label className="chk">
          <input type="checkbox" checked={settings.oppScan} onChange={(e) => save({ oppScan: e.target.checked })} />
          {t('opp.background')}
        </label>
        <label className="chk">
          {t('opp.perDay')}
          <input type="number" min={1} max={100} value={settings.craftsPerDay} style={{ width: 56 }}
            onChange={(e) => save({ craftsPerDay: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} />
        </label>
        <button className="btn" disabled={busy || !!st?.scanning} onClick={async () => { setBusy(true); try { await window.api.oppScanNow() } finally { setBusy(false) } }}>
          {t('opp.scanNow')}
        </button>
      </div>
      <Discover t={t} />
      <p className="status small">
        {st?.scanning ? t('opp.scanning') + ' · ' : ''}
        {t('opp.progress', { n: scanned, total: st?.total ?? 0 })}
        {last ? ' · ' + t('opp.updated', { ago: fmtAgo(t, last) }) : ''}
      </p>
      {rows.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl opp-tbl">
            <thead>
              <tr>
                {head('name', t('opp.col.item'))}
                {head('sell', t('opp.col.sell'), t('opp.hint.sell'))}
                {head('cost', t('opp.col.cost'), t('opp.hint.cost'))}
                {head('profit', t('opp.col.profit'))}
                {head('sales', t('opp.col.sales'), t('opp.hint.sales'))}
                {head('day', t('opp.col.day'), t('opp.hint.day'))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, sellC, profit, roi, day }) => (
                <tr key={r.key} className={r.craftItem ? 'click' : undefined} title={r.error ? r.error : r.variant}
                  onClick={() => r.craftItem && onOpen(r.craftItem)}>
                  <td>
                    <div>{r.name[lang]}</div>
                    <div className="muted small">{t(`s.${r.slot}` as never)}{r.variant ? ` · ${r.variant}` : ''}</div>
                  </td>
                  <td className="n">{r.sellFast ? <Money chaos={sellC} divine={r.divine} className="small" /> : '—'}</td>
                  <td className="n">
                    {r.cost != null ? <Money chaos={r.cost} divine={r.divine} className="small" /> : <span className="muted small">{r.error ? '!' : '—'}</span>}
                    {r.costP90 != null && r.cost != null && <div className="muted small">p90 <Money chaos={r.costP90} divine={r.divine} className="small" /></div>}
                  </td>
                  <td className={'n ' + (profit == null ? '' : profit > 0 ? 'up' : 'down')}>
                    {profit != null ? <Money chaos={profit} divine={r.divine} className="small" /> : '—'}
                    {roi != null && <div className="small">{Math.round(roi * 100)}%</div>}
                  </td>
                  <td className="n mono">{r.sales == null ? <span className="muted" title={t('opp.hint.noSales')}>…</span> : r.sales >= 10 ? Math.round(r.sales) : r.sales.toFixed(1)}</td>
                  <td className={'n ' + (day == null ? '' : day > 0 ? 'up' : 'down')}>{day != null ? <Money chaos={day} divine={r.divine} className="small" /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!rows.length && <p className="placeholder">{t('opp.empty')}</p>}
      <p className="note">{t('opp.note')}</p>
    </div>
  )
}

/** Автопоиск выгодных сочетаний модов: дорогие свежие лоты слота → частые сочетания → «Добавить в профили». */
function Discover({ t }: { t: T }) {
  const [slot, setSlot] = useState<SlotId>('body')
  const [minDiv, setMinDiv] = useState('1')
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<DiscoveredCombo[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<number>>(new Set())
  const name = (c: DiscoveredCombo) => c.stats.map((x) => x.label.replace('#', String(x.min))).join(' · ')
  return (
    <section className="rx-sec">
      <h3>{t('opp.discover')}</h3>
      <p className="muted small">{t('opp.discoverHint')}</p>
      <div className="row end">
        <SlotSelect id="d-slot" label={t('market.slot')} value={slot} onChange={setSlot} t={t} />
        <div className="field" style={{ maxWidth: 90 }}>
          <label htmlFor="d-min">{t('opp.minDiv')}</label>
          <input id="d-min" type="text" inputMode="decimal" value={minDiv} onChange={(e) => setMinDiv(e.target.value.replace(/[^\d.,]/g, ''))} />
        </div>
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true)
          setErr(null)
          setSaved(new Set())
          try {
            setList(await window.api.discoverCombos(slot, Number(minDiv.replace(',', '.')) || 1))
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}>{busy ? t('opp.discoverBusy') : t('opp.discoverBtn')}</button>
      </div>
      {err && <p className="err small">{err}</p>}
      {list && !list.length && <p className="muted small">{t('opp.discoverNone')}</p>}
      {list && list.length > 0 && (
        <ul className="combo-list">
          {list.map((c, i) => (
            <li key={i}>
              <div>{name(c)}</div>
              <div className="muted small">{t('opp.discoverStat', { n: c.count, total: c.sample, price: c.medianDiv.toFixed(1) })}</div>
              <button className="btn small-btn" disabled={saved.has(i)} onClick={async () => {
                await window.api.saveCombo(c, name(c))
                setSaved((s) => new Set(s).add(i))
              }}>{saved.has(i) ? t('opp.discoverSaved') : t('opp.discoverAdd')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
