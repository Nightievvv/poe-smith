import { useEffect, useMemo, useState } from 'react'
import type { ItemModData } from '../../shared/types'
import { REGEX_LIMIT } from '../../shared/mapregex'
import { buildItemRegex, type ItemRegexPick } from '../../shared/itemregex'
import type { T } from './i18n'

/** Генератор regex предметов: база → моды с минимальным тиром → строка для поиска в тайнике/у торговца. */
const STORE = 'poesmith.itemRegex'
interface Saved {
  base: string
  picks: ItemRegexPick[]
  mode: 'any' | 'all'
}

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return { base: '', picks: [], mode: 'any', ...JSON.parse(raw) }
  } catch {
    /* без хранилища */
  }
  return { base: '', picks: [], mode: 'any' }
}

export function ItemRegex({ t }: { t: T }) {
  const [bases, setBases] = useState<{ name: string; itemClass: string }[]>([])
  const [s, setS] = useState<Saved>(loadSaved)
  const [cls, setCls] = useState('')
  const [data, setData] = useState<ItemModData | null>(null)
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.itemBases().then(setBases)
  }, [])
  useEffect(() => {
    if (!s.base) return setData(null)
    window.api.itemMods(s.base).then(setData)
  }, [s.base])
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(s))
    } catch {
      /* без сохранения */
    }
    setCopied(false)
  }, [s])

  const res = useMemo(() => (data ? buildItemRegex(data, s.picks, s.mode) : null), [data, s.picks, s.mode])
  const len = res?.regex.length ?? 0
  const picked = new Map(s.picks.map((p) => [p.id, p.tier]))
  const setPick = (id: string, tier: number | null) =>
    setS((cur) => ({ ...cur, picks: tier == null ? cur.picks.filter((p) => p.id !== id) : [...cur.picks.filter((p) => p.id !== id), { id, tier }] }))

  const chooseBase = (name: string) => {
    if (bases.some((b) => b.name === name)) setS((cur) => ({ ...cur, base: name, picks: cur.base === name ? cur.picks : [] }))
  }
  // тип предмета: по сохранённой базе, пока пользователь не выбрал другой
  const classes = useMemo(() => [...new Set(bases.map((b) => b.itemClass))], [bases])
  const curCls = cls || bases.find((b) => b.name === s.base)?.itemClass || ''
  const clsBases = bases.filter((b) => b.itemClass === curCls)

  const sq = q.trim().toLowerCase()
  const groups = (data?.groups ?? []).filter((g) => !sq || g.text.toLowerCase().includes(sq))
  groups.sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)))

  return (
    <>
      <div className="rx-out">
        <textarea readOnly value={res?.regex ?? ''} placeholder={t('rx.itemPlaceholder')} rows={3} aria-label={t('rx.result')} />
        <div className="row">
          <span className={'mono small ' + (len > REGEX_LIMIT ? 'err' : 'muted')}>{t('rx.length', { n: len, max: REGEX_LIMIT })}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setS((cur) => ({ ...cur, picks: [] }))}>{t('rx.reset')}</button>
          <button className="btn primary" disabled={!res?.regex}
            onClick={async () => { await navigator.clipboard.writeText(res!.regex); setCopied(true) }}>
            {copied ? t('rx.copied') : t('rx.copy')}
          </button>
        </div>
        {len > REGEX_LIMIT && <p className="err small">{t('rx.tooLong')}</p>}
        {!!res?.failed.length && <p className="err small">{t('rx.failed', { n: res.failed.length })}</p>}
      </div>
      <section className="rx-sec">
        <div className="row">
          <div className="field">
            <label htmlFor="rx-cls">{t('rx.itemType')}</label>
            <select id="rx-cls" value={curCls} onChange={(e) => { setCls(e.target.value); const first = bases.find((b) => b.itemClass === e.target.value); if (first) chooseBase(first.name) }}>
              {!curCls && <option value="">{t('rx.itemTypePh')}</option>}
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rx-base">{t('rx.base')}</label>
            <select id="rx-base" value={s.base} disabled={!curCls} onChange={(e) => chooseBase(e.target.value)}>
              {!s.base && <option value="">—</option>}
              {clsBases.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
          </div>
        </div>
      </section>
      {data && (
        <section className="rx-sec">
          <h3>
            {t('rx.itemMods')} <span className="muted small">{s.picks.length ? `(${s.picks.length})` : ''}</span>
            <span className="mode-switch">
              <button aria-pressed={s.mode === 'any'} onClick={() => setS((c) => ({ ...c, mode: 'any' }))}>{t('rx.any')}</button>
              <button aria-pressed={s.mode === 'all'} onClick={() => setS((c) => ({ ...c, mode: 'all' }))}>{t('rx.all')}</button>
            </span>
          </h3>
          <input type="text" value={q} placeholder={t('rx.filter')} onChange={(e) => setQ(e.target.value)} aria-label={t('rx.filter')} />
          <ul className="rx-mods rx-items">
            {groups.map((g) => {
              const tier = picked.get(g.id)
              return (
                <li key={g.id}>
                  <label>
                    <input type="checkbox" checked={tier != null} onChange={(e) => setPick(g.id, e.target.checked ? 0 : null)} />
                    <span className={'rx-line gen-' + g.gen}>{g.text}</span>
                  </label>
                  {tier != null && (
                    <select value={tier} onChange={(e) => setPick(g.id, Number(e.target.value))} aria-label={t('rx.minTier')}>
                      {g.tiers.map((x, i) => (
                        <option key={i} value={i}>≥T{i + 1}: {x.text.replace(/\n/g, ' / ')} (ilvl {x.ilvl})</option>
                      ))}
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
