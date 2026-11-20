import { useEffect, useMemo, useRef, useState } from 'react'
import type { PcFilter, PcResult, PriceCheckState, Settings } from '../../shared/types'
import { makeT } from './i18n'
import { ItemCard } from './ItemCard'
import { errText, fmtTotal } from './format'
import { CurrencyAmount, divParts } from './Currency'
import { genClass } from './ItemCard'

const GROUPS: { id: string; kinds: PcFilter['kind'][] }[] = [
  { id: 'pc.general', kinds: ['base', 'gem', 'quality', 'flag', 'ilvl', 'pseudo', 'weapon', 'defence'] },
  { id: 'pc.sockets', kinds: ['links', 'sockets'] },
  { id: 'pc.implicits', kinds: ['implicit', 'enchant'] },
  { id: 'pc.mods', kinds: ['explicit', 'fractured', 'crafted'] }
]

const parseNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

/** Отдельное окно слева от оверлея: карточка с выбором модов, порогами и 15 самыми дешёвыми лотами. */
export function PriceCheckApp() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<PriceCheckState | null>(null)
  const [filters, setFilters] = useState<PcFilter[]>([])
  const [result, setResult] = useState<PcResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchId = useRef(0)
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  // раскрытые строки результатов (индексы)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [moreBusy, setMoreBusy] = useState(false)
  // курс Divine для цен на плитках уникальных (до первого поиска результата ещё нет)
  const [rate, setRate] = useState<number | null>(null)
  useEffect(() => {
    window.api.getDivine().then(setRate).catch(() => undefined)
  }, [])

  const loadMore = async () => {
    if (!state || !result?.queryId || !result.rest?.length) return
    const id = searchId.current
    setMoreBusy(true)
    setError(null)
    try {
      const r = await window.api.pcMore(state.item, result.queryId, result.rest)
      // новые лоты добавляются в конец: уже показанные строки и раскрытые карточки не сдвигаются
      if (id === searchId.current) setResult((cur) => (cur ? { ...cur, rows: [...cur.rows, ...r.rows], rest: r.rest } : cur))
    } catch (e) {
      if (id === searchId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoreBusy(false)
    }
  }

  const t = useMemo(() => makeT(settings?.lang ?? 'ru'), [settings?.lang])

  const run = async (s: PriceCheckState, f: PcFilter[]) => {
    const id = ++searchId.current
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.pcSearch(s.item, f)
      if (id === searchId.current) {
        setResult(r)
        setOpen(new Set())
      }
    } catch (e) {
      if (id === searchId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === searchId.current) setLoading(false)
    }
  }

  const accept = (s: PriceCheckState | null) => {
    setState(s)
    setResult(null)
    setProfileMsg(null)
    if (!s) return
    setFilters(s.filters)
    // неопознанный уникальный — сначала выбор предмета плиткой
    if (s.uniques) return
    run(s, s.filters) // первый поиск сразу, дальше — по кнопке «Искать»
  }

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.getPriceCheck().then(accept)
    const off = window.api.onEvent((e) => {
      if (e.type === 'priceCheck') accept(e.data)
    })
    const onFocus = () => window.api.getSettings().then(setSettings)
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const patch = (key: string, p: Partial<PcFilter>) => setFilters((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)))
  const divine = result?.divine

  return (
    <div className="ov pc" style={{ ['--op' as string]: settings?.opacity ?? 94 }}>
      <div className="ov-head">
        <span className="logo">{t('pc.title')}</span>
        <button className="ico" aria-label={t('hide')} title={t('hide')} onClick={() => window.api.closePriceCheck()}>✕</button>
      </div>
      <div className="ov-body">
        {!state && <p className="placeholder">{t('pc.empty', { key: settings?.hotkeys.price ?? 'Ctrl+D' })}</p>}
        {state && (
          <>
            <ItemCard item={state.item} t={t} hideMods
              extra={<button className="btn" title={t('market.toCraft')} onClick={() => {
                // цена для расчёта прибыли — медиана 10 самых дешёвых найденных лотов
                const v = (result?.rows ?? []).slice(0, 10).map((r) => r.priceDiv).sort((a, b) => a - b)
                const valueDiv = v.length ? v[Math.floor((v.length - 1) / 2)] : undefined
                window.api.openInCraft({ ...state.item, valueDiv })
              }}>{t('pc.toCraft')}</button>} />
            {state.uniques && (
              <div className="pc-uniques">
                <p className="muted small">{t('pc.pickUnique', { base: state.item.baseType })}</p>
                {state.uniques.length === 0 && <p className="note">{t('pc.noUniques')}</p>}
                <div className="uq-grid">
                  {state.uniques.map((u) => (
                    <button key={u.name} className="uq-tile" onClick={() => {
                      const s2 = { ...state, item: { ...state.item, name: u.name }, uniques: undefined }
                      setState(s2)
                      run(s2, filters)
                    }}>
                      {u.icon ? <img src={u.icon} alt="" /> : <span className="uq-noimg" />}
                      <span className="uq-name r-unique">{u.name}</span>
                      {u.chaos != null && (() => {
                        const pp = rate ? divParts(u.chaos / rate, rate) : null
                        return pp ? <CurrencyAmount amount={pp.amount} id={pp.id} className="small" /> : <CurrencyAmount amount={Math.round(u.chaos)} id="chaos" className="small" />
                      })()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!state.uniques && GROUPS.map((g) => {
              const list = filters.filter((f) => g.kinds.includes(f.kind))
              if (!list.length) return null
              return (
                <div key={g.id} className="pc-group">
                  <div className="lbl">{t(g.id as never)}</div>
                  {list.map((f) => (
                    <div key={f.key}>
                    <div className={'pc-row k-' + f.kind + (f.matched ? '' : ' off')}>
                      <input type="checkbox" checked={f.enabled} disabled={!f.matched} aria-label={f.label}
                        onChange={(e) => patch(f.key, { enabled: e.target.checked })} />
                      <span className={'tier' + genClass(f.gen, f.tier) + (f.tier ? '' : ' none')}>{f.tier ?? '·'}</span>
                      <span className="pc-label" title={f.matched ? undefined : t('pc.noStat')}>
                        {f.kind === 'links' ? t('pc.links') : f.kind === 'sockets' ? t('pc.socketCount') : f.label}
                      </span>
                      {f.kind !== 'base' && f.kind !== 'flag' && f.matched && (
                        <>
                          <input className="num" type="text" inputMode="decimal" placeholder={t('pc.min')} aria-label={t('pc.min')}
                            value={f.min ?? ''} onChange={(e) => patch(f.key, { min: parseNum(e.target.value), enabled: true })} />
                          <input className="num" type="text" inputMode="decimal" placeholder={t('pc.max')} aria-label={t('pc.max')}
                            value={f.max ?? ''} onChange={(e) => patch(f.key, { max: parseNum(e.target.value), enabled: true })} />
                        </>
                      )}
                    </div>
                    {f.colors && (
                      <div className="pc-colors">
                        <span className="muted small">{t('pc.colors')}</span>
                        {(['r', 'g', 'b', 'w'] as const).map((c) => (
                          <input key={c} className={'num sock-' + c} type="text" inputMode="numeric" placeholder={c.toUpperCase()}
                            aria-label={t(`pc.color.${c}` as never)} title={t(`pc.color.${c}` as never)} value={f.colors![c] ?? ''}
                            onChange={(e) => patch(f.key, { colors: { ...f.colors!, [c]: parseNum(e.target.value) }, enabled: true })} />
                        ))}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              )
            })}
            {!state.uniques && <>
            <div className="row end">
              <button className="btn primary" disabled={loading} onClick={() => run(state, filters)}>{t('pc.search')}</button>
              <button className="btn" disabled={loading} onClick={() => setFilters(state.filters)}>{t('pc.reset')}</button>
            </div>
            <form className="row end" onSubmit={async (e) => {
              e.preventDefault()
              const r = await window.api.saveProfile(state.item, filters, profileName)
              setProfileMsg(r.ok ? t('pc.profileSaved') : r.error === 'NO_SLOT' ? t('pc.profileNoSlot') : r.error ?? '')
              if (r.ok) setProfileName('')
            }}>
              <div className="field">
                <label htmlFor="pc-pname">{t('pc.profileName')}</label>
                <input id="pc-pname" type="text" value={profileName} placeholder={state.item.name} onChange={(e) => setProfileName(e.target.value)} />
              </div>
              <button type="submit" className="btn">{t('pc.saveProfile')}</button>
            </form>
            {profileMsg && <p className="muted small">{profileMsg}</p>}
            </>}
            {loading && <p className="note">{t('item.checking')}</p>}
            {error && <p className="note warn">{errText(t, error)}</p>}
            {result && !loading && (
              <div className="pc-results">
                <div className="detail-head">
                  <span className="small">{t('pc.found', { n: fmtTotal(result.total), shown: result.rows.length })}</span>
                  <span className="row">
                    {result.rows.some((r) => r.item) && (
                      <button className="btn small-btn" onClick={() => setOpen(open.size ? new Set() : new Set(result.rows.map((_, i) => i)))}>
                        {open.size ? t('pc.collapseAll') : t('pc.expandAll')}
                      </button>
                    )}
                    <a href={result.tradeUrl} target="_blank" rel="noreferrer">{t('market.openTrade')}</a>
                  </span>
                </div>
                {result.rows.length === 0 && <p className="note">{t('pc.nothing')}</p>}
                <ol className="pc-list">
                  {result.rows.map((row, i) => {
                    const toggle = () => row.item && setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n })
                    const pp = divParts(row.priceDiv, divine)
                    if (open.has(i) && row.item)
                      return (
                        <li key={i} className="pc-open" title={t('pc.collapse')} onClick={toggle}>
                          <ItemCard item={row.item} t={t}
                            extra={<div className="ex-price">{row.amount != null ? <CurrencyAmount amount={row.amount} id={row.currency!} /> : pp && <CurrencyAmount amount={pp.amount} id={pp.id} />}</div>} />
                        </li>
                      )
                    return (
                      <li key={i} className={row.item ? 'click' : undefined} role={row.item ? 'button' : undefined} tabIndex={row.item ? 0 : undefined}
                        aria-expanded={row.item ? false : undefined} title={row.item ? t('pc.expand') : undefined} onClick={toggle}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}>
                        <span className={'pc-name r-' + (row.rarity ?? 'rare').toLowerCase()}>{row.name}</span>
                        <span className="muted mono">{row.quality ? `${row.quality}%` : ''}</span>
                        <span className="muted">{row.ilvl || ''}</span>
                        <span className="mono">{row.amount != null ? <CurrencyAmount amount={row.amount} id={row.currency!} /> : pp ? <CurrencyAmount amount={pp.amount} id={pp.id} /> : '—'}</span>
                      </li>
                    )
                  })}
                </ol>
                {(result.rest?.length ?? 0) > 0 && (
                  <button className="btn more" disabled={moreBusy} onClick={loadMore}>
                    {moreBusy ? t('item.checking') : t('pc.more', { n: Math.min(15, result.rest!.length) })}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
