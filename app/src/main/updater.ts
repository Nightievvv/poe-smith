import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

/**
 * Обновления из GitHub Releases (Nightievvv/poe-smith, настройка publish в package.json).
 * Приложение только проверяет и сообщает о новой версии; скачивание и установка — по кнопке пользователя.
 * Скачанное, но не установленное обновление ставится при выходе из приложения.
 * В режиме разработки (не собранное приложение) обновления выключены.
 */
const { autoUpdater } = electronUpdater
const CHECK_EVERY = 6 * 3600 * 1000

let state: UpdateState = { status: app.isPackaged ? 'idle' : 'disabled', current: app.getVersion() }
let emit: (s: UpdateState) => void = () => {}

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  emit(state)
}

export const updateState = () => state

export function initUpdater(onChange: (s: UpdateState) => void) {
  emit = onChange
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  autoUpdater.on('update-available', (i) => set({ status: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, progress: 100 }))
  autoUpdater.on('error', (e) => set({ status: 'error', error: e?.message ?? String(e) }))
  setTimeout(() => void checkForUpdates(), 15_000)
  setInterval(() => {
    // уже нашли или скачали — не дёргаем GitHub повторно
    if (state.status === 'idle' || state.status === 'none' || state.status === 'error') void checkForUpdates()
  }, CHECK_EVERY)
}

export async function checkForUpdates() {
  if (!app.isPackaged || state.status === 'checking' || state.status === 'downloading') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
  return state
}

export async function downloadUpdate() {
  if (state.status !== 'available' && !(state.status === 'error' && state.version)) return
  set({ status: 'downloading', progress: 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

export function installUpdate() {
  if (state.status !== 'ready') return
  // тихая установка в ту же папку и перезапуск
  autoUpdater.quitAndInstall(true, true)
}
