import type { UpdateState } from '../../shared/types'
import type { T } from './i18n'

/** Плашка о новой версии: скачивание и установка только по кнопке. */
export function UpdateBanner({ u, t }: { u: UpdateState | null; t: T }) {
  if (!u) return null
  if (u.status === 'available' || (u.status === 'error' && u.version))
    return (
      <div className="upd" role="status">
        <span>{u.status === 'error' ? t('upd.failed', { err: u.error ?? '' }) : t('upd.available', { v: u.version ?? '' })}</span>
        <button className="btn primary" onClick={() => window.api.downloadUpdate()}>{t('upd.download')}</button>
      </div>
    )
  if (u.status === 'downloading')
    return (
      <div className="upd" role="status">
        <span>{t('upd.downloading', { p: u.progress ?? 0 })}</span>
        <progress max={100} value={u.progress ?? 0} />
      </div>
    )
  if (u.status === 'ready')
    return (
      <div className="upd" role="status">
        <span>{t('upd.ready', { v: u.version ?? '' })}</span>
        <button className="btn primary" onClick={() => window.api.installUpdate()}>{t('upd.install')}</button>
      </div>
    )
  return null
}

/** Строки в настройках: текущая версия и ручная проверка. */
export function UpdateStatus({ u, t }: { u: UpdateState | null; t: T }) {
  if (!u) return null
  const text =
    u.status === 'disabled' ? t('upd.dev')
      : u.status === 'checking' ? t('upd.checking')
        : u.status === 'none' ? t('upd.latest')
          : u.status === 'error' ? t('upd.failed', { err: u.error ?? '' })
            : u.status === 'available' ? t('upd.available', { v: u.version ?? '' })
              : u.status === 'downloading' ? t('upd.downloading', { p: u.progress ?? 0 })
                : u.status === 'ready' ? t('upd.ready', { v: u.version ?? '' })
                  : ''
  return (
    <>
      <label>{t('upd.version')}</label>
      <div className="row">
        <span className="mono">{u.current}</span>
        <button className="btn" disabled={u.status === 'disabled' || u.status === 'checking' || u.status === 'downloading'}
          onClick={() => window.api.checkUpdate()}>{t('upd.check')}</button>
      </div>
      {text && <p className="muted small full">{text}</p>}
    </>
  )
}
