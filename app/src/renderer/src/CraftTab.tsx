import { useEffect, useState } from 'react'
import type { CraftDataStatus, CraftPlan, Lang, ParsedItem } from '../../shared/types'
import type { T } from './i18n'
import { ItemCard } from './ItemCard'

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
}

export function CraftTab({ t, lang, item, readFailed, readKey, onClose, stepSignal }: Props) {
  const [selected, setSelected] = useState<boolean[]>([])
  const [plan, setPlan] = useState<CraftPlan | null>(null)
  const [done, setDone] = useState<boolean[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CraftDataStatus | null>(null)

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
  }, [item])

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
      setDone(p.steps.map(() => false))
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
        <button className="btn primary" disabled={busy || !selected.some(Boolean)} onClick={build}>{t('craft.build')}</button>
      </div>
      {(busy || data?.loading) && <p className="note">{data?.loading ? t('craft.loadingData') : t('craft.building')}</p>}
      {data?.error && <p className="note warn">{t('craft.dataError', { err: data.error })}</p>}
      {error && <p className="note warn">{t('market.profileError', { err: error })}</p>}

      {plan && (
        <>
          <div className="goal">
            <div className="chips">
              <span className="chip stage-c">{t('craft.stage')}: {plan.stage}</span>
              <span className="chip">{plan.method}</span>
              <span className="chip">ilvl {plan.ilvl}+</span>
              {plan.totalChaos != null && plan.totalChaos > 0 && <span className="chip mono">≈ {fmtCost(plan.totalChaos, plan.divine)}</span>}
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
          {plan.warnings.map((w, i) => <p key={i} className="note warn">{w}</p>)}
          <ol className="steps">
            {plan.steps.map((s, i) => (
              <li key={i} className={'step k-' + s.kind + (done[i] ? ' done' : '')}>
                <input type="checkbox" checked={!!done[i]} aria-label={s.title}
                  onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))} />
                <div>
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
