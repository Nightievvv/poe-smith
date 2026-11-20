import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Settings } from '../shared/types'

const dir = () => app.getPath('userData')
const settingsPath = () => join(dir(), 'settings.json')
const sessionPath = () => join(dir(), 'session.bin')

export function defaultSettings(): Settings {
  return {
    lang: app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en',
    game: 'poe1',
    league: '',
    hotkeys: {
      toggle: 'Ctrl+Shift+F',
      read: 'Ctrl+Alt+D',
      price: 'Ctrl+D',
      click: 'Ctrl+Shift+T',
      step: 'Ctrl+Shift+N',
      tab: 'Ctrl+Tab'
    },
    opacity: 94,
    clickThrough: false,
    scanInterval: '30m',
    outlier: 'iqr1.5',
    maxAgeDays: 7,
    marketMin: { value: 0, currency: 'divine' },
    customPrices: {},
    onlyWhenGameFocused: true,
    favorites: [],
    // уведомления о выгодных крафтах — по желанию, по умолчанию выключены
    notify: false,
    notifyEveryMin: 60,
    window: {}
  }
}

export function loadSettings(): Settings {
  const def = defaultSettings()
  try {
    if (!existsSync(settingsPath())) return def
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<Settings> & { v?: number }
    // миграция v2: умолчания «прайс-чек ↔ крафт» поменялись местами; переназначенные вручную клавиши не трогаем
    if ((raw.v ?? 1) < 2 && raw.hotkeys?.read === 'Ctrl+D' && raw.hotkeys?.price === 'Ctrl+Alt+D') {
      raw.hotkeys = { ...raw.hotkeys, read: 'Ctrl+Alt+D', price: 'Ctrl+D' }
    }
    // миграция v3: оверлей показывается только поверх игры — теперь это поведение по умолчанию
    if ((raw.v ?? 1) < 3) raw.onlyWhenGameFocused = true
    return {
      ...def,
      ...raw,
      hotkeys: { ...def.hotkeys, ...(raw.hotkeys ?? {}) },
      customPrices: { ...(raw.customPrices ?? {}) },
      window: { ...(raw.window ?? {}) }
    }
  } catch {
    return def
  }
}

export function writeSettings(s: Settings): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify({ ...s, v: 3 }, null, 2), 'utf-8')
}

// ---------- POESESSID: хранится только локально, зашифрован средствами Windows (DPAPI) ----------

export function hasSession(): boolean {
  return existsSync(sessionPath())
}

export function setSession(value: string): { ok: boolean; error?: 'format' | 'encryption' } {
  const v = value.trim()
  if (!/^[0-9a-f]{32}$/i.test(v)) return { ok: false, error: 'format' }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption' }
  mkdirSync(dir(), { recursive: true })
  writeFileSync(sessionPath(), safeStorage.encryptString(v))
  return { ok: true }
}

/** Только для запросов к трейду из main-процесса; в окно оверлея значение не передаётся. */
export function getSession(): string | null {
  try {
    if (!hasSession()) return null
    return safeStorage.decryptString(readFileSync(sessionPath()))
  } catch {
    return null
  }
}

export function clearSession(): void {
  if (hasSession()) unlinkSync(sessionPath())
}
