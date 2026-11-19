import { useEffect, useState } from 'react'
import type { CraftDataStatus, CraftPlan, Lang, ParsedItem } from '../../shared/types'
import type { T } from './i18n'
import { ItemCard } from './ItemCard'
import { errText } from './format'

const fmtCost = (chaos: number | undefined, divine: number | null) =>
  chaos == null ? '' : divine && chaos >= divine ? `${(chaos / divine).toFixed(1)} div` : `${Math.max(1, Math.round(chaos))}c`

interface Props {
  t: T
  lang: Lang
  item: ParsedItem | null
  readFailed: boolean
  readKey: string
  onClose: () => void
  /** растёт при нажатии горячей клавиши «Отметить следующий шаг» */
  stepSignal: number
  customPrices: Record<string, number>
  saveCustomPrices: (p: Record<string, number>) => Promise<void>
}

export function CraftTab({ t, lang, item, readFailed, readKey, onClose, stepSignal, customPrices, saveCustomPrices }: Props) {
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<boolean[]>([])
  const [plan, setPlan] = useState<CraftPlan | null>(null)
  const [vi, setVi] = useState(0)
  const [done, setDone] = useState<boolean[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CraftDataStatus | null>(null)
  // цена продажи готового предмета (Divine) — для расчёта прибыли
  const [valueDiv, setValueDiv] = useState<number | null>(null)
  const [valueDraft, setValueDraft] = useState('')
  const [valueBusy, setValueBusy] = useState(false)
  const [valueNote, setValueNote] = useState<string | null>(null)

  useEffect(() => {
    window.api.craftDataStatus().then(setData)
    return window.api.onEvent((e) => {
      if (e.type === 'craftData') setData(e.data)
    })
  }, [])

  // новый предмет: по умолчанию цель — все моды предмета
  useEffect(() => {
    setSelected(item ? item.mods.map(() => true) : [])
    setPlan(null)
    setError(null)
    const v = item?.valueDiv ?? null
    setValueDiv(v)
    setValueDraft(v ? String(Math.round(v * 100) / 100) : '')
    setValueNote(null)
  }, [item])

  const estimate = async () => {
    if (!item) return
    setValueBusy(true)
    setValueNote(null)
    try {
      const r = await window.api.estimateValue(item)
      if (r.count) {
        setValueDiv(r.valueDiv)
        setValueDraft(String(Math.round(r.valueDiv * 100) / 100))
        setValueNote(t('craft.valueFrom', { n: r.count, total: r.total }))
      } else setValueNote(t('craft.valueNone'))
    } catch (e) {
      setValueNote(errText(t, e instanceof Error ? e.message : String(e)))
    } finally {
      setValueBusy(false)
    }
  }

  const divine = plan?.divine ?? null
  const valueChaos = valueDiv && divine ? valueDiv * divine : null
  const profit = (v: CraftPlan['variants'][number]) => {
    if (!valueChaos) return null
    const lo = valueChaos - v.costMax
    const hi = valueChaos - v.costMin
    const mid = (lo + hi) / 2
    return { lo, hi, pLo: lo / valueChaos, pHi: hi / valueChaos, pMid: mid / valueChaos }
  }
  const signed = (c: number) => (c < 0 ? '−' : '+') + fmtCost(Math.abs(c), divine)

  useEffect(() => {
    if (!plan || !stepSignal) return
    setDone((d) => {
      const i = d.findIndex((x) => !x)
      if (i < 0) return d
      const n = [...d]
      n[i] = true
      return n
    })
  }, [stepSignal])

  const build = async () => {
    if (!item) return
    setBusy(true)
    setError(null)
    try {
      const idx = selected.map((s, i) => (s ? i : -1)).filter((i) => i >= 0)
      const p = await window.api.craftPlan(item, idx, lang)
      setPlan(p)
      setVi(0)
      setDone((p.variants[0]?.steps ?? []).map(() => false))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!item)
    return (
      <>
        {readFailed && <p className="note warn">{t('item.failed', { key: readKey })}</p>}
        <p className="placeholder">{t('craft.empty', { key: readKey })}</p>
      </>
    )

  return (
    <>
      <ItemCard item={item} t={t} onClose={onClose} selected={selected}
        onToggle={(i) => setSelected((s) => s.map((v, j) => (j === i ? !v : v)))} />
      <p className="muted small">{t('craft.pickHint')}</p>
      <div className="row end">
        <div className="field">
          <label htmlFor="c-value">{t('craft.value')}</label>
          <input id="c-value" type="text" inputMode="decimal" placeholder="div" value={valueDraft}
            onChange={(e) => {
              const s = e.target.value.replace(/[^\d.,]/g, '')
              setValueDraft(s)
              const n = Number(s.replace(',', '.'))
              setValueDiv(n > 0 ? n : null)
            }} />
        </div>
        <button className="btn" disabled={valueBusy} onClick={estimate}>{valueBusy ? t('craft.valueBusy') : t('craft.estimate')}</button>
        <button className="btn primary" disabled={busy || !selected.some(Boolean)} onClick={build}>{t('craft.build')}</button>
      </div>
      {valueNote && <p className="muted small">{valueNote}</p>}
      {(busy || data?.loading) && <p className="note">{data?.loading ? t('craft.loadingData') : t('craft.building')}</p>}
      {data?.error && <p className="note warn">{t('craft.dataError', { err: data.error })}</p>}
      {error && <p className="note warn">{t('market.profileError', { err: error })}</p>}

      {plan && (
        <>
          <div className="goal">
            <div className="chips">
              <span className="chip stage-c">{t('craft.stage')}: {plan.stage}</span>
              <span className="chip">ilvl {plan.ilvl}+</span>
            </div>
            <ul className="mods targets">
              {plan.targets.map((x, i) => (
                <li key={i} className={'k-' + x.kind + (x.found ? '' : ' off')}>
                  <span className={'tier' + (x.tier ? '' : ' none')}>{x.tier ?? '·'}</span>
                  <span className="mtext">{x.text}</span>
                  <span className="src muted">{x.source}</span>
                </li>
              ))}
            </ul>
          </div>
          {plan.warnings.filter((w) => !plan.missingPrices.some((m) => w.includes(m))).map((w, i) => <p key={i} className="note warn">{w}</p>)}
          {plan.missingPrices.length > 0 && (
            <div className="missing">
              <div className="small">{t('craft.missingPrices')}</div>
              {plan.missingPrices.map((n) => (
                <div key={n} className="row">
                  <label className="small" htmlFor={'mp-' + n}>{n}</label>
                  <input id={'mp-' + n} className="num" type="text" inputMode="decimal" placeholder="c"
                    value={priceDraft[n] ?? (customPrices[n] ? String(customPrices[n]) : '')}
                    onChange={(e) => setPriceDraft({ ...priceDraft, [n]: e.target.value.replace(/[^\d.,]/g, '') })} />
                </div>
              ))}
              <button className="btn" onClick={async () => {
                const next = { ...customPrices }
                for (const [k, v] of Object.entries(priceDraft)) { const x = Number(v.replace(',', '.')); if (x > 0) next[k] = x; else delete next[k] }
                await saveCustomPrices(next)
                setPriceDraft({})
                build()
              }}>{t('craft.savePrices')}</button>
            </div>
          )}
          {plan.variants[0] && (() => {
            const pr = profit(plan.variants[0])
            if (!pr) return <p className="note">{t('craft.noValue')}</p>
            if (pr.pMid < 0.3)
              return (
                <div className="buy-banner" role="alert">
                  <b>{t('craft.buyTitle')}</b>
                  <span>{t('craft.buyText', { m: Math.round(pr.pMid * 100), v: fmtCost(valueChaos!, divine) })}</span>
                </div>
              )
            return null
          })()}
          {plan.variants.length > 0 && (
            <div className="variants" role="radiogroup" aria-label={t('craft.variants')}>
              <div className="lbl">{t('craft.variants')}</div>
              {plan.variants.map((v, i) => (
                <button key={i} role="radio" aria-checked={vi === i} className={'variant' + (vi === i ? ' on' : '')}
                  onClick={() => { setVi(i); setDone(v.steps.map(() => false)) }}>
                  <span className="vname">{v.name}{i === 0 && <span className="best">{t('craft.recommended')}</span>}</span>
                  <span className="vchips">{v.mechanics.map((m) => <span key={m} className="mech">{m}</span>)}</span>
                  <span className="mono vcost">{v.costMax ? `${fmtCost(v.costMin, plan.divine)}–${fmtCost(v.costMax, plan.divine)}` : '—'}</span>
                  {(() => {
                    const pr = profit(v)
                    if (!pr) return null
                    return (
                      <span className={'vprofit mono ' + (pr.pMid >= 0.3 ? 'up' : pr.pMid >= 0 ? 'warnc' : 'down')}>
                        profit ~{signed(pr.lo)}…{signed(pr.hi)} ({Math.round(pr.pLo * 100)}…{Math.round(pr.pHi * 100)}%)
                      </span>
                    )
                  })()}
                </button>
              ))}
            </div>
          )}
          {plan.variants[vi]?.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
          <ol className="steps">
            {(plan.variants[vi]?.steps ?? []).map((s, i) => (
              <li key={i} className={'step k-' + s.kind + (s.optional ? ' optional' : '') + (done[i] ? ' done' : '')}>
                <input type="checkbox" checked={!!done[i]} aria-label={s.title}
                  onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))} />
                <div>
                  {s.optional && <span className="opt">{t('craft.optional')}</span>}
                  <h4>{i + 1}. {s.title}</h4>
                  {s.detail && <div className="muted small">{s.detail}</div>}
                  <dl className="meta">
                    {s.currency.length > 0 && (
                      <>
                        <dt>{t('craft.currency')}</dt>
                        <dd className="cur">
                          {s.currency.map((c, j) => (
                            <span key={j}>{c.name} {c.count}{c.chaos != null ? ` (≈ ${fmtCost(c.chaos, plan.divine)})` : ''}{j < s.currency.length - 1 ? ', ' : ''}</span>
                          ))}
                        </dd>
                      </>
                    )}
                    {s.station && <><dt>{t('craft.where')}</dt><dd>{s.station}</dd></>}
                    {s.farm && <><dt>{t('craft.farm')}</dt><dd>{s.farm}</dd></>}
                  </dl>
                </div>
              </li>
            ))}
          </ol>
          <p className="note">{t('craft.disclaimer', { v: data?.version ?? '' })}</p>
        </>
      )}
    </>
  )
}
