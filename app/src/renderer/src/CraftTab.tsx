import { useEffect, useState } from 'react'
import type { AddableData, CraftDataStatus, CraftPlan, CraftVariant, Lang, ParsedItem, StepLine } from '../../shared/types'
import type { T } from './i18n'
import { ItemCard, genClass } from './ItemCard'
import { errText } from './format'
import { useItemIcons } from './itemIcons'

const fmtCost = (chaos: number | undefined, divine: number | null) =>
  chaos == null ? '' : divine && chaos >= divine ? `${(chaos / divine).toFixed(1)} div` : `${Math.max(1, Math.round(chaos))}c`

const range = (lo: number, hi: number, divine: number | null) => {
  const a = fmtCost(lo, divine), b = fmtCost(hi, divine)
  return a === b ? a : `${a}–${b}`
}

/** вариант в выбранном режиме доводки */
function view(v: CraftVariant | undefined, mode: 'joint' | 'single'): CraftVariant | undefined {
  if (!v) return v
  return mode === 'single' && v.single ? { ...v, ...v.single } : v
}
/** варианты по возрастанию стоимости в выбранном режиме; i — индекс в plan.variants */
function order(p: CraftPlan, mode: 'joint' | 'single') {
  return p.variants.map((v, i) => ({ v: view(v, mode)!, i })).sort((a, b) => a.v.costMissMax - b.v.costMissMax)
}

function Lines({ lines }: { lines: StepLine[] }) {
  return (
    <div className="lines">
      {lines.map((l, i) =>
        typeof l === 'string' ? (
          <div key={i} className={/^(Альтернативы|Alternatives):/.test(l) ? 'alt' : undefined}>{l}</div>
        ) : 'warn' in l ? (
          <div key={i} className="lwarn">{l.warn}</div>
        ) : (
          <div key={i} className={'mline' + (l.gen ? ' gen-' + l.gen : '')}>{l.mod}</div>
        )
      )}
    </div>
  )
}

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
  const icons = useItemIcons()
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({})
  const [journalMsg, setJournalMsg] = useState<string | null>(null)
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
  // доводка: для всех модов сразу или для каждого по отдельности
  const [mode, setMode] = useState<'joint' | 'single'>('joint')
  const [ignoreIlvl, setIgnoreIlvl] = useState(false)
  // полный крафт (как раньше) или докрафт этого предмета
  const [craftMode, setCraftMode] = useState<'full' | 'finish'>('full')
  const [addable, setAddable] = useState<AddableData | null>(null)
  const [picks, setPicks] = useState<{ gid: string; tier: number }[]>([])
  const [addQ, setAddQ] = useState('')

  useEffect(() => {
    window.api.craftDataStatus().then(setData)
    return window.api.onEvent((e) => {
      if (e.type === 'craftData') setData(e.data)
    })
  }, [])

  // новый предмет: по умолчанию цель — все моды предмета
  useEffect(() => {
    setSelected(item ? item.mods.map(() => true) : [])
    setPicks([])
    setAddable(null)
    if (item) window.api.craftAddable(item).then(setAddable).catch(() => setAddable(null))
    setPlan(null)
    setIgnoreIlvl(false)
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
    const lo = valueChaos - v.costMissMax
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

  const build = async (ign = ignoreIlvl) => {
    if (!item) return
    setBusy(true)
    setError(null)
    try {
      const finish = craftMode === 'finish'
      // докрафт: имплиситы и энчанты всегда остаются; снимаются только явные моды без галочки
      const idx = selected.map((s, i) => (s || (finish && (item.mods[i].kind === 'implicit' || item.mods[i].kind === 'enchant')) ? i : -1)).filter((i) => i >= 0)
      const add = finish ? picks.map((p) => addable?.groups.find((g) => g.id === p.gid)?.tiers[p.tier]?.id).filter((x): x is string => !!x) : undefined
      const p = await window.api.craftPlan(item, idx, lang, { ignoreIlvl: ign, mode: craftMode, add })
      setPlan(p)
      const first = order(p, mode)[0]?.i ?? 0
      setVi(first)
      setDone((view(p.variants[first], mode)?.steps ?? []).map(() => false))
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = plan ? order(plan, mode) : []
  const cur = plan?.variants[vi] ? view(plan.variants[vi], mode) : undefined

  if (!item)
    return (
      <>
        {readFailed && <p className="note warn">{t('item.failed', { key: readKey })}</p>}
        <p className="placeholder">{t('craft.empty', { key: readKey })}</p>
      </>
    )

  // занятые и свободные слоты: отмеченные моды предмета + выбранные для докрафта
  const finish = craftMode === 'finish'
  const slots = { prefix: 0, suffix: 0 }
  for (const e of addable?.existing ?? []) if (selected[e.idx] && e.gen) slots[e.gen]++
  if (finish) for (const p of picks) { const g = addable?.groups.find((x) => x.id === p.gid); if (g) slots[g.gen]++ }
  const maxSide = addable?.maxSide ?? 3
  const usedGroups = new Set<string>([
    ...(addable?.existing ?? []).filter((e) => selected[e.idx]).flatMap((e) => e.groups),
    ...(finish ? picks.flatMap((p) => addable?.groups.find((x) => x.id === p.gid)?.groups ?? []) : [])
  ])
  const toggle = (i: number) => {
    const e = addable?.existing.find((x) => x.idx === i || x.extra.includes(i))
    if (finish && e?.locked) return // fractured не снять
    const lines = e ? [e.idx, ...e.extra] : [i]
    setSelected((s) => { const v = !s[i]; return s.map((x, j) => (lines.includes(j) ? v : x)) })
  }
  const slotChip = (
    <span className="slots mono small">
      <span className={slots.prefix > maxSide ? 'err' : 't-pre-c'}>{t('craft.prefixes')} {slots.prefix}/{maxSide}</span>
      {' · '}
      <span className={slots.suffix > maxSide ? 'err' : 't-suf-c'}>{t('craft.suffixes')} {slots.suffix}/{maxSide}</span>
    </span>
  )
  const sq = addQ.trim().toLowerCase()

  return (
    <>
      <div className="seg craft-mode" role="tablist">
        {(['full', 'finish'] as const).map((m) => (
          <button key={m} role="tab" aria-pressed={craftMode === m} aria-selected={craftMode === m}
            onClick={() => { setCraftMode(m); setPlan(null) }}>{t(m === 'full' ? 'craft.modeFull' : 'craft.modeFinish')}</button>
        ))}
      </div>
      <ItemCard item={item} t={t} onClose={onClose} selected={selected} onToggle={toggle} extra={addable ? slotChip : undefined} />
      <p className="muted small">{t(finish ? 'craft.finishHint' : 'craft.pickHint')}</p>
      {finish && addable?.blocked === 'corrupted' && <p className="note warn">{t('craft.finishCorrupted')}</p>}
      {finish && addable && !addable.blocked && (
        <section className="rx-sec add-mods">
          <h3>{t('craft.addMods')} <span className="muted small">{picks.length ? `(${picks.length})` : ''}</span></h3>
          <input type="text" value={addQ} placeholder={t('rx.filter')} aria-label={t('rx.filter')} onChange={(e) => setAddQ(e.target.value)} />
          <ul className="rx-mods rx-items">
            {addable.groups
              .filter((g) => !sq || g.text.toLowerCase().includes(sq))
              .sort((a, b) => Number(picks.some((p) => p.gid === b.id)) - Number(picks.some((p) => p.gid === a.id)))
              .map((g) => {
                const pick = picks.find((p) => p.gid === g.id)
                const why = pick ? null
                  : g.groups.some((x) => usedGroups.has(x)) ? t('craft.addSameGroup')
                    : slots[g.gen] >= maxSide ? t(g.gen === 'prefix' ? 'craft.addNoPrefix' : 'craft.addNoSuffix')
                      : g.bench && (addable.existing.some((e) => e.crafted && selected[e.idx]) || picks.some((p) => addable.groups.find((x) => x.id === p.gid)?.bench)) ? t('craft.addOneBench')
                        : null
                return (
                  <li key={g.id} className={why ? 'off' : undefined} title={why ?? undefined}>
                    <label>
                      <input type="checkbox" checked={!!pick} disabled={!!why}
                        onChange={(e) => setPicks((ps) => (e.target.checked ? [...ps, { gid: g.id, tier: 0 }] : ps.filter((p) => p.gid !== g.id)))} />
                      <span className={'rx-line gen-' + g.gen}>{g.text}</span>
                      {g.bench && <span className="rx-badge">{t('craft.benchBadge')}</span>}
                    </label>
                    {why && <span className="muted small add-why">{why}</span>}
                    {pick && g.tiers.length > 1 && (
                      <select value={pick.tier} aria-label={t('rx.minTier')}
                        onChange={(e) => setPicks((ps) => ps.map((p) => (p.gid === g.id ? { ...p, tier: Number(e.target.value) } : p)))}>
                        {g.tiers.map((x, i) => <option key={i} value={i}>≥T{i + 1}: {x.text.replace(/\n/g, ' / ')} (ilvl {x.ilvl})</option>)}
                      </select>
                    )}
                  </li>
                )
              })}
          </ul>
        </section>
      )}
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
        <button className="btn primary"
          disabled={busy || (finish ? !!addable?.blocked || (!picks.length && !(addable?.existing ?? []).some((e) => !selected[e.idx])) || slots.prefix > maxSide || slots.suffix > maxSide : !selected.some(Boolean))}
          onClick={() => build()}>{t('craft.build')}</button>
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
              <span className="chip">ilvl {plan.ilvlMax == null ? `${plan.ilvl}+` : plan.ilvlMax === plan.ilvl ? plan.ilvl : `${plan.ilvl}–${plan.ilvlMax}`}</span>
              {plan.ignoreIlvl && <span className="chip">{t('craft.ignoreIlvl')}</span>}
            </div>
            <ul className="mods targets">
              {plan.targets.map((x, i) => (
                <li key={i} className={'k-' + x.kind + (x.found ? '' : ' off')}>
                  <span className={'tier' + genClass(x.gen === 'implicit' ? undefined : x.gen, x.tier) + (x.tier ? '' : ' none')}>{x.tier ?? '·'}</span>
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
          {shown[0] && (() => {
            const pr = profit(shown[0].v)
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
              <div className="row spread">
                <div className="lbl">{t('craft.variants')}</div>
                <div className="mode-switch" role="group" aria-label={t('craft.modeHint')} title={t('craft.modeHint')}>
                  {(['joint', 'single'] as const).map((m) => (
                    <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setDone((view(plan.variants[vi], m)?.steps ?? []).map(() => false)) }}>
                      {t(m === 'joint' ? 'craft.modeJoint' : 'craft.modeSingle')}
                    </button>
                  ))}
                </div>
              </div>
              {shown.map(({ v, i }, k) => (
                <button key={i} role="radio" aria-checked={vi === i} className={'variant' + (vi === i ? ' on' : '')}
                  onClick={() => { setVi(i); setDone(v.steps.map(() => false)) }}>
                  <span className="vname">{v.name}{k === 0 && <span className="best">{t('craft.recommended')}</span>}</span>
                  <span className="vchips">{v.mechanics.map((m) => <span key={m} className="mech">{m}</span>)}</span>
                  <span className="vcost">
                    <span className="mono">{v.costMax ? range(v.costMin, v.costMax, plan.divine) : '—'}</span>
                    {v.costMissMax > v.costMax * 1.01 && (
                      <span className="mono vmiss">{t('craft.withMisses')}: {range(v.costMissMin, v.costMissMax, plan.divine)}</span>
                    )}
                  </span>
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
          {cur?.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
          {cur && (
            <div className="row end">
              <button className={'btn' + (ignoreIlvl ? ' on' : '')} aria-pressed={ignoreIlvl} title={t('craft.ignoreIlvlHint')} disabled={busy}
                onClick={() => { const n = !ignoreIlvl; setIgnoreIlvl(n); build(n) }}>
                {ignoreIlvl ? t('craft.respectIlvl') : t('craft.ignoreIlvl')}
              </button>
              <button className="btn" onClick={async () => {
                const v = cur
                await window.api.journalAdd({
                  itemName: item.name, baseType: item.baseType, variant: v.name, mechanics: v.mechanics,
                  plannedMin: v.costMin, plannedMax: v.costMax, valueChaos: valueChaos ?? null,
                  spentChaos: null, soldChaos: null, status: 'crafting'
                })
                setJournalMsg(t('craft.journalAdded'))
              }}>{t('craft.toJournal')}</button>
              {journalMsg && <span className="muted small">{journalMsg}</span>}
            </div>
          )}
          <ol className="steps">
            {(cur?.steps ?? []).map((s, i) => (
              <li key={i} className={'step k-' + s.kind + (s.optional ? ' optional' : '') + (done[i] ? ' done' : '')}>
                <input type="checkbox" checked={!!done[i]} aria-label={s.title}
                  onChange={() => setDone((d) => d.map((v, j) => (j === i ? !v : v)))} />
                <div>
                  <div className="shead">
                    {s.optional && <span className="opt">{t('craft.optional')}</span>}
                    {s.method && <span className="mech">{s.method}</span>}
                    {s.cost && s.cost[1] > 0 && (
                      <span className="scost">
                        <span className="mono">≈ {range(s.cost[0], s.cost[1], plan.divine)}</span>
                        {s.costMiss && s.costMiss[1] > s.cost[1] * 1.01 && (
                          <span className="mono smiss">{t('craft.withMisses')}: {range(s.costMiss[0], s.costMiss[1], plan.divine)}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <h4>{i + 1}. {s.title}</h4>
                  {s.lines && s.lines.length > 0 && <Lines lines={s.lines} />}
                  <dl className="meta">
                    {s.currency.length > 0 && (
                      <>
                        <dt>{t('craft.currency')}</dt>
                        <dd className="cur">
                          <ul className="cur-list">
                            {s.currency.map((c, j) => (
                              <li key={j} className={c.miss ? 'miss' : undefined}>
                                {icons[c.name] ? <img src={icons[c.name]} alt="" /> : <span className="cur-noimg" />}
                                <span className="cname">{c.name}</span>
                                <span className="mono ccount">{c.count}</span>
                                {c.chaos != null && <span className="mono muted">≈ {fmtCost(c.chaos, plan.divine)}</span>}
                                {c.miss && <span className="muted small">{t('craft.onMiss')}</span>}
                              </li>
                            ))}
                          </ul>
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
