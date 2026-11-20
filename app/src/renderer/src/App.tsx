import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExampleItem, HotkeyId, Limits, MarketQuery, ParsedItem, Settings, SlotMarket, UpdateState } from '../../shared/types'
import { UpdateBanner } from './UpdateBanner'
import { makeT } from './i18n'
import { matches } from './hotkeys'
import { SettingsTab } from './SettingsTab'
import { MarketTab } from './MarketTab'
import { CraftTab } from './CraftTab'
import { JournalTab } from './JournalTab'

type Tab = 'craft' | 'market' | 'journal' | 'settings'
const TABS: Tab[] = ['craft', 'market', 'journal', 'settings']

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<Tab>('craft')
  const [failed, setFailed] = useState<HotkeyId[]>([])
  const [query, setQueryState] = useState<MarketQuery>({ slot: 'body', subtype: 'any', minValue: 0, minCurrency: 'divine' })
  const [market, setMarket] = useState<SlotMarket | null>(null)
  const [divine, setDivine] = useState<number | null>(null)
  const [item, setItem] = useState<ParsedItem | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [limits, setLimits] = useState<Limits | null>(null)
  const [stepSignal, setStepSignal] = useState(0)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const recording = useRef(false)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      setQueryState((q) => ({ ...q, minValue: s.marketMin.value, minCurrency: s.marketMin.currency }))
    })
    window.api.getLimits().then(setLimits)
    window.api.getDivine().then(setDivine)
    window.api.updateState().then(setUpdate)
  }, [])

  const setQuery = (q: MarketQuery) => {
    setQueryState(q)
    const m = settings?.marketMin
    if (settings && (m?.value !== q.minValue || m?.currency !== q.minCurrency)) {
      const marketMin = { value: q.minValue, currency: q.minCurrency }
      setSettings({ ...settings, marketMin })
      window.api.saveSettings({ marketMin })
    }
  }

  const sameQuery = (m: SlotMarket) => m.slot === queryRef.current.slot && m.subtype === queryRef.current.subtype
  const openCraft = (it: ParsedItem) => {
    setItem(it)
    setReadFailed(false)
    setTab('craft')
  }

  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.type === 'clickThrough') setSettings((s) => (s ? { ...s, clickThrough: e.value } : s))
        if (e.type === 'hotkey') {
          if (e.id === 'read') setTab('craft')
          if (e.id === 'tab') setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length])
          if (e.id === 'step') setStepSignal((n) => n + 1)
        }
        if (e.type === 'market' && sameQuery(e.data)) {
          setMarket(e.data)
          if (e.data.divine) setDivine(e.data.divine)
        }
        if (e.type === 'item') {
          if (e.item) openCraft(e.item)
          else setReadFailed(true)
        }
        if (e.type === 'openCraft') openCraft(e.item)
        if (e.type === 'openTab') setTab(e.tab)
        if (e.type === 'limits') setLimits(e.data)
        if (e.type === 'update') setUpdate(e.data)
      }),
    []
  )

  // показываем только кэш; трейд опрашивается по кнопке «Найти», чтобы не тратить лимиты
  useEffect(() => {
    if (tab !== 'market') return
    setMarket(null)
    window.api.getMarket(query).then((m) => {
      if (sameQuery(m)) setMarket((cur) => (cur?.scanning ? cur : m))
    })
  }, [query.slot, query.subtype, query.minValue, query.minCurrency, tab, settings?.league])

  // локальные сочетания: работают, только когда окно оверлея в фокусе
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!settings || recording.current) return
      if (matches(e, settings.hotkeys.tab)) {
        e.preventDefault()
        setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length])
      } else if (matches(e, settings.hotkeys.step)) {
        e.preventDefault()
        setStepSignal((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings])

  const t = useMemo(() => makeT(settings?.lang ?? 'ru'), [settings?.lang])

  if (!settings) return null

  const save = async (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch })
    const r = await window.api.saveSettings(patch)
    setSettings(r.settings)
    setFailed(r.hotkeys.failed)
  }

  const limitText = !limits
    ? ''
    : Math.max(limits.search.blockedFor, limits.fetch.blockedFor) > 0
      ? t('limits.blocked', { n: Math.max(limits.search.blockedFor, limits.fetch.blockedFor) })
      : t('limits', { s: limits.search.used, sm: limits.search.max, f: limits.fetch.used, fm: limits.fetch.max })

  return (
    <div className="ov" style={{ ['--op' as string]: settings.opacity }} lang={settings.lang}>
      <div className="ov-head">
        <span className="logo">PoESmith</span>
        {settings.hotkeys.toggle && <span className="kbd">{settings.hotkeys.toggle}</span>}
        <button className="ico" title={t('hide')} aria-label={t('hide')} onClick={() => window.api.hide()}>
          ✕
        </button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {t(`tab.${id}`)}
          </button>
        ))}
      </div>

      <div className="ov-body">
        <UpdateBanner u={update} t={t} />
        {/* вкладка крафта не размонтируется: план и отметки шагов сохраняются при переходе на другие вкладки */}
        <div className="tab-pane" hidden={tab !== 'craft'}>
          <CraftTab t={t} lang={settings.lang} item={item} readFailed={readFailed} readKey={settings.hotkeys.read || '—'}
            onClose={() => setItem(null)} stepSignal={stepSignal}
            customPrices={settings.customPrices} saveCustomPrices={(customPrices) => save({ customPrices })} />
        </div>
        {tab === 'market' && (
          <MarketTab t={t} lang={settings.lang} query={query} setQuery={setQuery} market={market} divine={divine}
            onExample={(e: ExampleItem) => openCraft({ ...e, valueDiv: e.valueDiv ?? (e.priceDiv || undefined) })}
            onReload={() => window.api.getMarket(query).then((m) => { if (sameQuery(m)) setMarket(m) })}
            favorites={settings.favorites} setFavorites={(favorites) => save({ favorites })} />
        )}
        {tab === 'journal' && <JournalTab t={t} divine={divine} />}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            t={t}
            failed={failed}
            update={update}
            save={save}
            onRecording={(r) => {
              recording.current = r
              window.api.suspendHotkeys(r)
            }}
          />
        )}
      </div>

      <div className="ov-foot">
        <span>{settings.clickThrough ? t('clickThroughOn') : limitText}</span>
        <span className="mono">v{update?.current ?? ''}</span>
      </div>
    </div>
  )
}
