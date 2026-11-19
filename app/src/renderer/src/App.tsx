import { useEffect, useMemo, useRef, useState } from 'react'
import type { HotkeyId, Limits, ParsedItem, PriceCheck, Settings, SlotId, SlotMarket } from '../../shared/types'
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
  const [marketSlot, setMarketSlot] = useState<SlotId>('body')
  const [market, setMarket] = useState<SlotMarket | null>(null)
  const [item, setItem] = useState<{ item: ParsedItem | null } | null>(null)
  const [check, setCheck] = useState<PriceCheck | null>(null)
  const [limits, setLimits] = useState<Limits | null>(null)
  const recording = useRef(false)
  const marketSlotRef = useRef(marketSlot)
  marketSlotRef.current = marketSlot

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.getLimits().then(setLimits)
  }, [])

  useEffect(
    () =>
      window.api.onEvent((e) => {
        if (e.type === 'clickThrough') setSettings((s) => (s ? { ...s, clickThrough: e.value } : s))
        if (e.type === 'hotkey') {
          if (e.id === 'read') setTab('craft')
          if (e.id === 'price') setTab('market')
          if (e.id === 'tab') setTab((t) => TABS[(TABS.indexOf(t) + 1) % TABS.length])
        }
        if (e.type === 'market' && e.data.slot === marketSlotRef.current) setMarket(e.data)
        if (e.type === 'item') {
          setItem({ item: e.item })
          if (e.item?.slot) {
            setCraftSlot(e.item.slot)
            if (e.mode === 'price') setMarketSlot(e.item.slot)
          }
          if (e.mode === 'price' && !e.item) setCheck(null)
        }
        if (e.type === 'priceCheck') setCheck(e.data)
        if (e.type === 'limits') setLimits(e.data)
      }),
    []
  )

  // кэш рынка для выбранного слота (main сам запустит сканирование, если кэш устарел)
  useEffect(() => {
    if (tab !== 'market') return
    setMarket(null)
    window.api.getMarket(marketSlot).then((m) => {
      if (m.slot === marketSlotRef.current) setMarket((cur) => (cur?.scanning ? cur : m))
    })
  }, [marketSlot, tab, settings?.league])

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
            slot={marketSlot}
            setSlot={setMarketSlot}
            market={market}
            check={check}
            clearCheck={() => setCheck(null)}
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
