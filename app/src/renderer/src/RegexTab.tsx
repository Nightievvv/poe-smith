import { useEffect, useMemo, useState } from 'react'
import type { MapModData, MapModInfo } from '../../shared/types'
import { MAP_QUALITY, MAP_YIELDS, REGEX_LIMIT, buildMapRegex, emptyMapRegex, type MapRegexOptions, type Tri } from '../../shared/mapregex'
import type { Key, T } from './i18n'
import { ItemRegex } from './ItemRegex'

/** Вкладка «Regex»: строка поиска для карт в тайнике (моды, добыча, качество, состояние карты). */
const STORE = 'poesmith.mapRegex'

const YIELD_LABEL: Record<string, string> = {
  drops: 'Atlas Drops', pack: 'Monster Pack Size', maps: 'More Maps', rarity: 'Item Rarity', currency: 'More Currency', threads: 'More Threads', div: 'More Divination Cards',
  q: 'Quality', qpack: 'Quality (Pack Size)', qrarity: 'Quality (Rarity)', qcurrency: 'Quality (Currency)', qdiv: 'Quality (Divination Cards)', qthreads: 'Quality (Threads)'
}

function loadOpts(): MapRegexOptions {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) return { ...emptyMapRegex(), ...JSON.parse(raw) }
  } catch {
    /* нет хранилища — начинаем с пустых настроек */
  }
  return emptyMapRegex()
}

/** Вкладка «Regex»: две кнопки сверху — генератор для карт и для предметов. */
export function RegexTab({ t }: { t: T }) {
  const [kind, setKind] = useState<'maps' | 'items'>(() => {
    try {
      return localStorage.getItem('poesmith.regexKind') === 'items' ? 'items' : 'maps'
    } catch {
      return 'maps'
    }
  })
  const pick = (k: 'maps' | 'items') => {
    setKind(k)
    try {
      localStorage.setItem('poesmith.regexKind', k)
    } catch {
      /* без сохранения */
    }
  }
  return (
    <div className="rx-tab">
      <div className="seg rx-kind" role="tablist">
        <button role="tab" aria-pressed={kind === 'maps'} aria-selected={kind === 'maps'} onClick={() => pick('maps')}>Maps</button>
        <button role="tab" aria-pressed={kind === 'items'} aria-selected={kind === 'items'} onClick={() => pick('items')}>Items</button>
      </div>
      {kind === 'maps' ? <MapRegex t={t} /> : <ItemRegex t={t} />}
    </div>
  )
}

function MapRegex({ t }: { t: T }) {
  const [data, setData] = useState<MapModData | null>(null)
  const [error, setError] = useState('')
  const [o, setO] = useState<MapRegexOptions>(loadOpts)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.mapMods().then(setData, (e) => setError(String(e?.message ?? e)))
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(o))
    } catch {
      /* без сохранения */
    }
    setCopied(false)
  }, [o])

  const res = useMemo(() => (data ? buildMapRegex(data, o) : null), [data, o])
  const set = (patch: Partial<MapRegexOptions>) => setO((cur) => ({ ...cur, ...patch }))
  const len = res?.regex.length ?? 0

  const copy = async () => {
    if (!res?.regex) return
    await navigator.clipboard.writeText(res.regex)
    setCopied(true)
  }

  const num = (group: 'yields' | 'quality', id: string) => (
    <label key={id} className="rx-num">
      <span>{YIELD_LABEL[id]}</span>
      <input
        type="number" min={0} max={999} step={1} inputMode="numeric" placeholder="—"
        value={o[group][id] || ''}
        onChange={(e) => set({ [group]: { ...o[group], [id]: Math.max(0, Math.min(999, Number(e.target.value) || 0)) } } as Partial<MapRegexOptions>)}
      />
      <span className="muted">%</span>
    </label>
  )
  const anyAll = (value: 'any' | 'all', onChange: (v: 'any' | 'all') => void) => (
    <span className="mode-switch">
      <button aria-pressed={value === 'any'} onClick={() => onChange('any')}>{t('rx.any')}</button>
      <button aria-pressed={value === 'all'} onClick={() => onChange('all')}>{t('rx.all')}</button>
    </span>
  )
  const tri = (label: string, value: Tri, onChange: (v: Tri) => void) => (
    <div className="rx-tri">
      <span>{label}</span>
      <span className="mode-switch">
        {(['any', 'include', 'exclude'] as Tri[]).map((v) => (
          <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{t(`rx.tri.${v}` as Key)}</button>
        ))}
      </span>
    </div>
  )

  return (
    <>
      <div className="rx-out">
        <textarea readOnly value={res?.regex ?? ''} placeholder={t('rx.placeholder')} rows={3} aria-label={t('rx.result')} />
        <div className="row">
          <span className={'mono small ' + (len > REGEX_LIMIT ? 'err' : 'muted')}>{t('rx.length', { n: len, max: REGEX_LIMIT })}</span>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setO(emptyMapRegex())}>{t('rx.reset')}</button>
          <button className="btn primary" disabled={!res?.regex} onClick={copy}>{copied ? t('rx.copied') : t('rx.copy')}</button>
        </div>
        {len > REGEX_LIMIT && <p className="err small">{t('rx.tooLong')}</p>}
        {!!res?.failed.length && <p className="err small">{t('rx.failed', { n: res.failed.length })}</p>}
      </div>
      {error && <p className="err">{error}</p>}
      {!data && !error && <p className="muted">{t('rx.loading')}</p>}

      <section className="rx-sec">
        <h3>{t('rx.yields')} {anyAll(o.yieldMode, (v) => set({ yieldMode: v }))}</h3>
        <div className="rx-grid">{MAP_YIELDS.map((y) => num('yields', y.id))}</div>
      </section>
      <section className="rx-sec">
        <h3>{t('rx.quality')} {anyAll(o.qualityMode, (v) => set({ qualityMode: v }))}</h3>
        <div className="rx-grid">{MAP_QUALITY.map((y) => num('quality', y.id))}</div>
      </section>
      <section className="rx-sec">
        <h3>{t('rx.state')}</h3>
        {tri(t('rx.corrupted'), o.corrupted, (v) => set({ corrupted: v }))}
        {tri(t('rx.unidentified'), o.unidentified, (v) => set({ unidentified: v }))}
        <div className="rx-tri">
          <span>{t('rx.rarity')}</span>
          <span className="rx-checks">
            {(['normal', 'magic', 'rare'] as const).map((r) => (
              <label key={r}>
                <input type="checkbox" checked={o.rarity.includes(r)}
                  onChange={(e) => set({ rarity: e.target.checked ? [...o.rarity, r] : o.rarity.filter((x) => x !== r) })} />
                {t(`rx.rar.${r}` as Key)}
              </label>
            ))}
          </span>
        </div>
      </section>
      {data && (
        <>
          <ModList t={t} title={t('rx.exclude')} mods={data.mods} selected={o.exclude} other={o.want}
            onChange={(exclude) => set({ exclude })} />
          <ModList t={t} title={t('rx.want')} mods={data.mods} selected={o.want} other={o.exclude}
            onChange={(want) => set({ want })} extra={anyAll(o.wantMode, (v) => set({ wantMode: v }))} />
        </>
      )}
    </>
  )
}

function ModList({ t, title, mods, selected, other, onChange, extra }: {
  t: T; title: string; mods: MapModInfo[]; selected: string[]; other: string[]; onChange: (ids: string[]) => void; extra?: React.ReactNode
}) {
  const [q, setQ] = useState('')
  const [t17, setT17] = useState(true)
  const sel = new Set(selected)
  const s = q.trim().toLowerCase()
  const list = mods.filter((m) => (t17 || !m.t17) && !other.includes(m.id) && (!s || m.text.toLowerCase().includes(s)))
  // выбранные — наверху
  list.sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)))
  return (
    <section className="rx-sec">
      <h3>
        {title} <span className="muted small">{selected.length ? `(${selected.length})` : ''}</span> {extra}
      </h3>
      <div className="row">
        <input type="text" value={q} placeholder={t('rx.filter')} onChange={(e) => setQ(e.target.value)} aria-label={t('rx.filter')} />
        <label className="rx-t17"><input type="checkbox" checked={t17} onChange={(e) => setT17(e.target.checked)} /> T17</label>
        {!!selected.length && <button className="btn small-btn" onClick={() => onChange([])}>{t('rx.clear')}</button>}
      </div>
      <ul className="rx-mods">
        {list.map((m) => (
          <li key={m.id}>
            <label>
              <input type="checkbox" checked={sel.has(m.id)} onChange={(e) => onChange(e.target.checked ? [...selected, m.id] : selected.filter((x) => x !== m.id))} />
              <span>
                {m.text.split('\n').map((l, i) => <span key={i} className="rx-line">{l}</span>)}
              </span>
              {m.t17 && <span className="rx-badge">T17</span>}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
