import { useEffect, useMemo, useState } from 'react'
import type { JournalEntry } from '../../shared/types'
import type { T } from './i18n'

const fmt = (c: number, divine: number | null) => {
  const a = Math.abs(c)
  const s = divine && a >= divine ? `${(a / divine).toFixed(1)} div` : `${Math.round(a)}c`
  return (c < 0 ? '−' : '') + s
}
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')) || null)

/** Журнал крафтов: план против факта и сводка по методам. Суммы вводятся в Chaos. */
export function JournalTab({ t, divine }: { t: T; divine: number | null }) {
  const [list, setList] = useState<JournalEntry[]>([])
  const reload = () => window.api.journalList().then(setList)
  useEffect(() => {
    reload()
  }, [])

  const patch = async (id: string, p: Partial<JournalEntry>) => {
    setList((l) => l.map((e) => (e.id === id ? { ...e, ...p } : e)))
    await window.api.journalUpdate(id, p)
  }

  // сводка: только записи, где известны и затраты, и продажа
  const summary = useMemo(() => {
    const closed = list.filter((e) => e.spentChaos != null && e.soldChaos != null)
    const spent = closed.reduce((a, e) => a + e.spentChaos!, 0)
    const sold = closed.reduce((a, e) => a + e.soldChaos!, 0)
    const by = new Map<string, { n: number; profit: number; planned: number; sold: number }>()
    for (const e of closed) {
      const k = e.mechanics[0] ?? e.variant
      const x = by.get(k) ?? { n: 0, profit: 0, planned: 0, sold: 0 }
      x.n++
      x.profit += e.soldChaos! - e.spentChaos!
      x.planned += e.valueChaos != null ? e.valueChaos - (e.plannedMin + e.plannedMax) / 2 : 0
      x.sold += e.soldChaos!
      by.set(k, x)
    }
    return { n: closed.length, spent, sold, profit: sold - spent, by: [...by.entries()].sort((a, b) => b[1].profit - a[1].profit) }
  }, [list])

  if (!list.length) return <p className="placeholder">{t('journal.empty')}</p>

  return (
    <>
      <div className="goal">
        <div className="lbl">{t('journal.summary', { n: summary.n })}</div>
        <div className="stats">
          <div><b>{fmt(summary.spent, divine)}</b><span>{t('journal.spent')}</span></div>
          <div><b>{fmt(summary.sold, divine)}</b><span>{t('journal.sold')}</span></div>
          <div><b className={summary.profit >= 0 ? 'up' : 'down'}>{fmt(summary.profit, divine)}</b><span>{t('journal.profit')}</span></div>
          <div><b>{summary.sold ? Math.round((summary.profit / summary.sold) * 100) : 0}%</b><span>{t('journal.margin')}</span></div>
        </div>
        {summary.by.length > 0 && (
          <table className="tbl">
            <thead><tr><th>{t('journal.method')}</th><th className="n">{t('journal.count')}</th><th className="n">{t('journal.actual')}</th><th className="n">{t('journal.planned')}</th></tr></thead>
            <tbody>
              {summary.by.map(([k, x]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="n">{x.n}</td>
                  <td className={'n ' + (x.profit >= 0 ? 'up' : 'down')}>{fmt(x.profit / x.n, divine)}</td>
                  <td className="n muted">{fmt(x.planned / x.n, divine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.map((e) => {
        const profit = e.spentChaos != null && e.soldChaos != null ? e.soldChaos - e.spentChaos : null
        return (
          <div key={e.id} className="jentry">
            <div className="detail-head">
              <span className="iname r-rare">{e.itemName}</span>
              <span className="muted small">{new Date(e.date).toLocaleDateString()}</span>
            </div>
            <div className="muted small">
              {e.baseType} · {e.variant} · {t('journal.plan')}: {fmt(e.plannedMin, divine)}–{fmt(e.plannedMax, divine)}
              {e.valueChaos != null ? ` · ${t('journal.expected')}: ${fmt(e.valueChaos, divine)}` : ''}
            </div>
            <div className="row jrow">
              <div className="field">
                <label htmlFor={'js-' + e.id}>{t('journal.spentC')}</label>
                <input id={'js-' + e.id} type="text" inputMode="decimal" defaultValue={e.spentChaos ?? ''}
                  onBlur={(ev) => patch(e.id, { spentChaos: num(ev.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor={'jo-' + e.id}>{t('journal.soldC')}</label>
                <input id={'jo-' + e.id} type="text" inputMode="decimal" defaultValue={e.soldChaos ?? ''}
                  onBlur={(ev) => patch(e.id, { soldChaos: num(ev.target.value), status: num(ev.target.value) != null ? 'sold' : e.status })} />
              </div>
              <div className="field">
                <label htmlFor={'jst-' + e.id}>{t('journal.status')}</label>
                <select id={'jst-' + e.id} value={e.status} onChange={(ev) => patch(e.id, { status: ev.target.value as JournalEntry['status'] })}>
                  {(['crafting', 'done', 'sold', 'failed'] as const).map((s) => <option key={s} value={s}>{t(`journal.st.${s}`)}</option>)}
                </select>
              </div>
              <button className="ico" aria-label={t('set.remove')} title={t('set.remove')}
                onClick={async () => { await window.api.journalRemove(e.id); reload() }}>✕</button>
            </div>
            {profit != null && (
              <div className={'small ' + (profit >= 0 ? 'up' : 'down')}>
                {t('journal.result')}: {fmt(profit, divine)}{e.soldChaos ? ` (${Math.round((profit / e.soldChaos) * 100)}%)` : ''}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
