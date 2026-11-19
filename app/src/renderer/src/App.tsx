import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExampleItem, HotkeyId, Limits, MarketQuery, ParsedItem, PriceCheck, Settings, SlotId, SlotMarket } from '../../shared/types'
import { SUBTYPES } from '../../shared/poe1/catalog'
import { makeT } from './i18n'
import { matches } from './hotkeys'
import { SettingsTab } from './SettingsTab'
import { SlotSelect } from './SlotSelect'
import { MarketTab } from './MarketTab'
import { ItemCard } from './ItemCard'

type Tab = 'craft' | 'market' | 'settings'
const TABS: Tab[] = ['craft', 'market', 'settings']

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<Tab>('craft')
  const [failed, setFailed] = useState<HotkeyId[]>([])
  const [craftSlot, setCraftSlot] = useState<SlotId>('body')
  const [query, setQueryState] = useState<MarketQuery>({ slot: 'body', subtype: 'any', minValue: 0, minCurrency: 'divine' })
  const [market, setMarket] = useState<SlotMarket | null>(null)
  const [divine, setDivine] = useState<number | null>(null)
  const [item, setItem] = useState<{ item: ParsedItem | null } | null>(null)
  const [check, setCheck] = useState<PriceCheck | null>(null)
  const [limits, setLimits] = useState<Limits | null>(null)
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

  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.type === 'clickThrough') setSettings((s) => (s ? { ...s, clickThrough: e.value } : s))
        if (e.type === 'hotkey') {
          if (e.id === 'read') setTab('craft')
          if (e.id === 'price') setTab('market')
          if (e.id === 'tab') setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length])
        }
        if (e.type === 'market' && sameQuery(e.data)) {
          setMarket(e.data)
          if (e.data.divine) setDivine(e.data.divine)
        }
        if (e.type === 'item') {
          setItem({ item: e.item })
          if (e.item?.slot) {
            setCraftSlot(e.item.slot)
            const slot = e.item.slot
            if (e.mode === 'price') setQueryState((q) => ({ ...q, slot, subtype: SUBTYPES[slot][0].id }))
          }
          if (e.mode === 'price' && !e.item) setCheck(null)
        }
        if (e.type === 'priceCheck') setCheck(e.data)
        if (e.type === 'limits') setLimits(e.data)
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

  const openExample = (e: ExampleItem) => {
    const explicit = e.mods.filter((m) => m.kind !== 'implicit' && m.kind !== 'enchant')
    setItem({
      item: {
        itemClass: '',
        rarity: e.rarity,
        name: e.name,
        baseType: e.baseType,
        itemLevel: e.ilvl,
        slot: query.slot,
        implicits: e.mods.filter((m) => m.kind === 'implicit' || m.kind === 'enchant').map((m) => m.text),
        mods: explicit.map((m) => m.text),
        modTiers: explicit.map((m) => m.tier),
        corrupted: e.corrupted
      }
    })
    setCraftSlot(query.slot)
    setTab('craft')
  }

  // локальные сочетания: работают, только когда окно оверлея в фокусе
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!settings || recording.current) return
      if (matches(e, settings.hotkeys.tab)) {
        e.preventDefault()
        setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length])
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
        <span className="logo">Exile Forge</span>
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
        {tab === 'craft' && (
          <>
            {item && !item.item && <p className="note warn">{t('item.failed', { key: settings.hotkeys.read || '—' })}</p>}
            {item?.item && <ItemCard item={item.item} t={t} onClose={() => setItem(null)} />}
            <SlotSelect id="c-slot" label={t('craft.slot')} value={craftSlot} onChange={setCraftSlot} t={t} />
            <p className="placeholder">{item?.item ? t('item.recipesSoon') : t('craft.placeholder')}</p>
            {settings.hotkeys.read && !item && <p className="note">{t('craft.readHint', { key: settings.hotkeys.read })}</p>}
          </>
        )}
        {tab === 'market' && (
          <MarketTab
            t={t}
            lang={settings.lang}
            query={query}
            setQuery={setQuery}
            market={market}
            divine={divine}
            check={check}
            clearCheck={() => setCheck(null)}
            onExample={openExample}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            t={t}
            failed={failed}
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
        <span className="mono">v0.2</span>
      </div>
    </div>
  )
}
