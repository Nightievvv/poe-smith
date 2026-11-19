import { useEffect, useMemo, useRef, useState } from 'react'
import type { PcFilter, PcResult, PriceCheckState, Settings } from '../../shared/types'
import { makeT } from './i18n'
import { ItemCard } from './ItemCard'
import { errText, fmtPrice, fmtTotal } from './format'

const GROUPS: { id: string; kinds: PcFilter['kind'][] }[] = [
  { id: 'pc.general', kinds: ['base', 'ilvl', 'pseudo', 'weapon', 'defence'] },
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

  const t = useMemo(() => makeT(settings?.lang ?? 'ru'), [settings?.lang])

  const run = async (s: PriceCheckState, f: PcFilter[]) => {
    const id = ++searchId.current
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.pcSearch(s.item, f)
      if (id === searchId.current) setResult(r)
    } catch (e) {
      if (id === searchId.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (id === searchId.current) setLoading(false)
    }
  }

  const accept = (s: PriceCheckState | null) => {
    setState(s)
    setResult(null)
    if (!s) return
    setFilters(s.filters)
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
        {!state && <p className="placeholder">{t('pc.empty', { key: settings?.hotkeys.price ?? 'Ctrl+Alt+D' })}</p>}
        {state && (
          <>
            <ItemCard item={state.item} t={t} hideMods
              extra={<button className="btn" title={t('market.toCraft')} onClick={() => window.api.openInCraft(state.item)}>{t('pc.toCraft')}</button>} />
            {GROUPS.map((g) => {
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
                      <span className={'tier' + (f.tier ? '' : ' none')}>{f.tier ?? '·'}</span>
                      <span className="pc-label" title={f.matched ? undefined : t('pc.noStat')}>
                        {f.kind === 'links' ? t('pc.links') : f.kind === 'sockets' ? t('pc.socketCount') : f.label}
                      </span>
                      {f.kind !== 'base' && f.matched && (
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
            <div className="row end">
              <button className="btn primary" disabled={loading} onClick={() => run(state, filters)}>{t('pc.search')}</button>
              <button className="btn" disabled={loading} onClick={() => setFilters(state.filters)}>{t('pc.reset')}</button>
            </div>
            {loading && <p className="note">{t('item.checking')}</p>}
            {error && <p className="note warn">{errText(t, error)}</p>}
            {result && !loading && (
              <div className="pc-results">
                <div className="detail-head">
                  <span className="small">{t('pc.found', { n: fmtTotal(result.total) })}</span>
                  <a href={result.tradeUrl} target="_blank" rel="noreferrer">{t('market.openTrade')}</a>
                </div>
                {result.rows.length === 0 && <p className="note">{t('pc.nothing')}</p>}
                <ol className="pc-list">
                  {result.rows.map((row, i) => (
                    <li key={i}>
                      <span className="pc-name">{row.name}</span>
                      <span className="muted">{row.ilvl ?? '—'}</span>
                      <span className="mono">{row.price}</span>
                      <span className="mono muted">{fmtPrice(row.priceDiv, divine)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
