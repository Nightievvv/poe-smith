import { useEffect, useState } from 'react'
import { HOTKEY_ORDER, HOTKEY_SCOPE, type HotkeyId, type LeagueInfo, type Settings } from '../../shared/types'
import { hotkeyLabel, type T } from './i18n'
import { accelFromEvent } from './hotkeys'

interface Props {
  settings: Settings
  t: T
  failed: HotkeyId[]
  save: (patch: Partial<Settings>) => Promise<void>
  onRecording: (r: boolean) => void
}

export function SettingsTab({ settings, t, failed, save, onRecording }: Props) {
  const [leagues, setLeagues] = useState<LeagueInfo | null>(null)
  const [recording, setRecording] = useState<HotkeyId | null>(null)
  const [hasSess, setHasSess] = useState(false)
  const [sess, setSess] = useState('')
  const [showSess, setShowSess] = useState(false)
  const [sessMsg, setSessMsg] = useState<'format' | 'encryption' | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.api.getLeagues().then(setLeagues)
    window.api.hasSession().then(setHasSess)
  }, [])

  // запись нового сочетания
  useEffect(() => {
    if (!recording) return
    onRecording(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      if (e.key === 'Backspace') {
        save({ hotkeys: { ...settings.hotkeys, [recording]: '' } })
        return setRecording(null)
      }
      const acc = accelFromEvent(e)
      if (!acc) return
      save({ hotkeys: { ...settings.hotkeys, [recording]: acc } })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      onRecording(false)
    }
  }, [recording])

  const counts: Record<string, number> = {}
  for (const id of HOTKEY_ORDER) {
    const a = settings.hotkeys[id]
    if (a) counts[a] = (counts[a] ?? 0) + 1
  }
  const dup = Object.keys(counts).filter((k) => counts[k] > 1)

  const saveSess = async () => {
    const r = await window.api.setSession(sess)
    if (r.ok) {
      setHasSess(true)
      setSess('')
      setSessMsg(null)
    } else setSessMsg(r.error ?? 'format')
  }

  const autoLabel = leagues?.currentSoftcore
    ? t('set.leagueAuto', { id: leagues.currentSoftcore })
    : t('set.leagueAutoUnknown')

  return (
    <div className="set">
      <div className="h">{t('set.game')}</div>
      <label htmlFor="s-game">{t('set.version')}</label>
      <select id="s-game" value={settings.game} onChange={(e) => save({ game: e.target.value as Settings['game'] })}>
        <option value="poe1">Path of Exile</option>
        <option value="poe2" disabled>
          {t('set.poe2later')}
        </option>
      </select>

      <label htmlFor="s-league">{t('set.league')}</label>
      <select id="s-league" value={settings.league} onChange={(e) => save({ league: e.target.value })}>
        <option value="">{autoLabel}</option>
        {leagues?.leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.text}
          </option>
        ))}
      </select>
      {leagues?.error && <p className="note warn full">{t('set.leagueError', { err: leagues.error })}</p>}

      <label htmlFor="s-lang">{t('set.lang')}</label>
      <select id="s-lang" value={settings.lang} onChange={(e) => save({ lang: e.target.value as Settings['lang'] })}>
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>

      <div className="h">{t('set.hotkeys')}</div>
      {HOTKEY_ORDER.map((id) => {
        const acc = settings.hotkeys[id]
        const cls = ['hk', recording === id && 'rec', acc && counts[acc] > 1 && 'conflict', failed.includes(id) && 'conflict', !acc && 'empty']
          .filter(Boolean)
          .join(' ')
        return (
          <div key={id} style={{ display: 'contents' }}>
            <label htmlFor={`hk-${id}`}>
              {hotkeyLabel(t, id)}
              {HOTKEY_SCOPE[id] === 'local' && <span className="sub">{t('set.hkLocal')}</span>}
            </label>
            <button id={`hk-${id}`} className={cls} onClick={() => setRecording(recording === id ? null : id)}>
              {recording === id ? t('set.hkPress') : acc || t('set.hkNone')}
            </button>
          </div>
        )
      })}
      <p className={'note full' + (dup.length || failed.length ? ' warn' : '')}>
        {dup.length
          ? t('set.hkConflict', { keys: dup.join(', ') })
          : failed.length
            ? t('set.hkFailed', { list: failed.map((id) => settings.hotkeys[id]).join(', ') })
            : t('set.hkHint')}
      </p>

      <div className="h">{t('set.window')}</div>
      <label htmlFor="s-op">{t('set.opacity')}</label>
      <input
        type="range"
        id="s-op"
        min={55}
        max={100}
        value={settings.opacity}
        onChange={(e) => save({ opacity: Number(e.target.value) })}
      />
      <label htmlFor="s-click">{t('set.clickThrough')}</label>
      <input
        type="checkbox"
        className="switch"
        id="s-click"
        checked={settings.clickThrough}
        onChange={(e) => save({ clickThrough: e.target.checked })}
      />

      <label htmlFor="s-focus">
        {t('set.onlyFocused')}
        <span className="sub">{t('set.onlyFocusedSub')}</span>
      </label>
      <input type="checkbox" className="switch" id="s-focus" checked={settings.onlyWhenGameFocused}
        onChange={(e) => save({ onlyWhenGameFocused: e.target.checked })} />

      <div className="h">{t('set.notify')}</div>
      <label htmlFor="s-notify">
        {t('set.notifyOn')}
        <span className="sub">{t('set.notifySub')}</span>
      </label>
      <input type="checkbox" className="switch" id="s-notify" checked={settings.notify}
        onChange={(e) => save({ notify: e.target.checked })} />
      {settings.notify && (
        <>
          <label htmlFor="s-notify-every">{t('set.notifyEvery')}</label>
          <select id="s-notify-every" value={settings.notifyEveryMin}
            onChange={(e) => save({ notifyEveryMin: Number(e.target.value) as Settings['notifyEveryMin'] })}>
            {([60, 120, 240] as const).map((m) => <option key={m} value={m}>{t('set.everyH', { n: m / 60 })}</option>)}
          </select>
          <span className="small">{t('set.favorites', { n: settings.favorites.length })}</span>
          <button className="btn" disabled={!settings.favorites.length || checking} onClick={async () => {
            setChecking(true)
            try { await window.api.checkFavorites() } finally { setChecking(false) }
          }}>{checking ? t('set.checking') : t('set.checkNow')}</button>
        </>
      )}

      <div className="h">{t('set.craft')}</div>
      <span className="full small muted">{t('set.customPricesHint')}</span>
      {Object.entries(settings.customPrices).map(([name, v]) => (
        <div key={name} style={{ display: 'contents' }}>
          <span className="small">{name}</span>
          <span className="row">
            <span className="mono small">{v}c</span>
            <button className="ico" aria-label={t('set.remove')} title={t('set.remove')} onClick={() => {
              const next = { ...settings.customPrices }
              delete next[name]
              save({ customPrices: next })
            }}>✕</button>
          </span>
        </div>
      ))}
      {Object.keys(settings.customPrices).length === 0 && <span className="full small muted">{t('set.noCustomPrices')}</span>}
      <span className="small">{t('set.harvestTable')}</span>
      <span className="row">
        <button className="btn" onClick={() => window.api.openHarvestFile()}>{t('set.open')}</button>
        <button className="btn" onClick={() => window.api.resetHarvestFile()}>{t('set.reset')}</button>
      </span>

      <div className="h">{t('set.account')}</div>
      <label htmlFor="s-sess" className="full">
        {t('set.sess')}
      </label>
      <form
        className="row full"
        onSubmit={(e) => {
          e.preventDefault()
          saveSess()
        }}
      >
        <input
          id="s-sess"
          type={showSess ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          placeholder={hasSess ? '••••••••••••••••' : t('set.sessPh')}
          value={sess}
          onChange={(e) => setSess(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => setShowSess(!showSess)}>
          {showSess ? t('set.hideVal') : t('set.show')}
        </button>
        <button type="submit" className="btn primary" disabled={!sess.trim()}>
          {t('set.save')}
        </button>
        {hasSess && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await window.api.clearSession()
              setHasSess(false)
            }}
          >
            {t('set.clear')}
          </button>
        )}
      </form>
      <p className={'note full' + (sessMsg ? ' warn' : '')}>
        {sessMsg === 'format'
          ? t('set.sessFormat')
          : sessMsg === 'encryption'
            ? t('set.sessEnc')
            : hasSess
              ? t('set.sessSaved')
              : t('set.sessNone')}
      </p>

      <div className="h">{t('set.scanner')}</div>
      <label htmlFor="s-src">{t('set.source')}</label>
      <select id="s-src" disabled>
        <option>poe.ninja</option>
      </select>
      <label htmlFor="s-out">{t('set.outlier')}</label>
      <select id="s-out" value={settings.outlier} onChange={(e) => save({ outlier: e.target.value as Settings['outlier'] })}>
        {(['iqr1.5', 'iqr3', 'p10-90'] as const).map((v) => (
          <option key={v} value={v}>
            {t(`set.out.${v}`)}
          </option>
        ))}
      </select>
      <label htmlFor="s-age">{t('set.age')}</label>
      <select
        id="s-age"
        value={settings.maxAgeDays}
        onChange={(e) => save({ maxAgeDays: Number(e.target.value) as Settings['maxAgeDays'] })}
      >
        {([3, 7, 14] as const).map((n) => (
          <option key={n} value={n}>
            {t('set.days', { n })}
          </option>
        ))}
      </select>
    </div>
  )
}
