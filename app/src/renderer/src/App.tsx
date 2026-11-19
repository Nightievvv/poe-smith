import { useEffect, useMemo, useRef, useState } from 'react'
import type { HotkeyId, Settings } from '../../shared/types'
import { makeT } from './i18n'
import { matches } from './hotkeys'
import { SettingsTab } from './SettingsTab'
import { SlotSelect } from './SlotSelect'

type Tab = 'craft' | 'market' | 'settings'
const TABS: Tab[] = ['craft', 'market', 'settings']

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tab, setTab] = useState<Tab>('craft')
  const [failed, setFailed] = useState<HotkeyId[]>([])
  const [craftSlot, setCraftSlot] = useState('s.body')
  const [marketSlot, setMarketSlot] = useState('s.body')
  const recording = useRef(false)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
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
      }),
    []
  )

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
            <SlotSelect id="c-slot" label={t('craft.slot')} value={craftSlot} onChange={setCraftSlot} t={t} />
            <p className="placeholder">{t('craft.placeholder')}</p>
            {settings.hotkeys.read && <p className="note">{t('craft.readHint', { key: settings.hotkeys.read })}</p>}
          </>
        )}
        {tab === 'market' && (
          <>
            <SlotSelect id="m-slot" label={t('market.slot')} value={marketSlot} onChange={setMarketSlot} t={t} />
            <p className="placeholder">{t('market.placeholder')}</p>
          </>
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
        <span>{settings.clickThrough ? t('clickThroughOn') : ''}</span>
        <span className="mono">v0.1</span>
      </div>
    </div>
  )
}
