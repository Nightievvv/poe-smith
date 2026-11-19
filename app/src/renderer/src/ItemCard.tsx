import type { ItemMod, ItemProps, ParsedItem } from '../../shared/types'
import type { T } from './i18n'

const isImplicit = (m: ItemMod) => m.kind === 'implicit' || m.kind === 'enchant'
const r = (a: number, b: number) => `${a}–${b}`

/** Основные параметры: урон/DPS для оружия, защита для брони, гнёзда, качество, требования. */
export function PropsBlock({ p, t }: { p: ItemProps; t: T }) {
  const w = p.weapon
  const d = p.defence
  const rows: [string, string, string?][] = []
  if (w) {
    if (w.phys) rows.push([t('prop.phys'), r(...w.phys)])
    for (const e of w.ele) rows.push([t(`prop.${e.type}` as never), r(e.min, e.max), 'dmg-' + e.type])
    if (w.chaos) rows.push([t('prop.chaos'), r(...w.chaos), 'dmg-chaos'])
    if (w.crit != null) rows.push([t('prop.crit'), `${w.crit.toFixed(2)}%`])
    if (w.aps != null) rows.push([t('prop.aps'), w.aps.toFixed(2)])
  }
  if (d) {
    if (d.ar) rows.push([t('prop.ar'), String(d.ar)])
    if (d.ev) rows.push([t('prop.ev'), String(d.ev)])
    if (d.es) rows.push([t('prop.es'), String(d.es)])
    if (d.ward) rows.push([t('prop.ward'), String(d.ward)])
    if (d.block) rows.push([t('prop.block'), `${d.block}%`])
  }
  if (p.quality) rows.push([t('prop.quality'), `+${p.quality}%`])
  if (p.sockets) rows.push([t('prop.sockets'), `${p.sockets.text} · ${p.sockets.count}S / ${p.sockets.links}L`])
  const req = p.req
  const reqText = req
    ? [req.level && `${t('prop.lvl')} ${req.level}`, req.str && `${t('prop.str')} ${req.str}`, req.dex && `${t('prop.dex')} ${req.dex}`, req.int && `${t('prop.int')} ${req.int}`].filter(Boolean).join(' · ')
    : ''
  if (!rows.length && !reqText && !w) return null
  return (
    <div className="props">
      {rows.map(([k, v, cls], i) => (
        <div key={i} className="prop"><span className="muted">{k}</span><b className={cls}>{v}</b></div>
      ))}
      {w && (
        <div className="dps">
          <span>DPS <b>{w.dps}</b></span>
          <span>{t('prop.pdps')} <b>{w.pdps}</b></span>
          <span>{t('prop.edps')} <b className="dmg-ele">{w.edps}</b></span>
          {w.cdps > 0 && <span>{t('prop.cdps')} <b className="dmg-chaos">{w.cdps}</b></span>}
        </div>
      )}
      {reqText && <div className="req muted small">{t('prop.req')}: {reqText}</div>}
    </div>
  )
}

export function ModLine({ m, children }: { m: ItemMod; children?: React.ReactNode }) {
  return (
    <li className={'k-' + m.kind}>
      {children}
      <span className={'tier' + (m.tier ? '' : ' none')}>{m.tier ?? '·'}</span>
      <span className="mtext">{m.text}</span>
    </li>
  )
}

interface Props {
  item: ParsedItem
  t: T
  onClose?: () => void
  /** режим выбора модов (крафт): отмеченные индексы item.mods */
  selected?: boolean[]
  onToggle?: (i: number) => void
  hideMods?: boolean
  extra?: React.ReactNode
}

export function ItemCard({ item, t, onClose, selected, onToggle, hideMods, extra }: Props) {
  const rarityCls = 'r-' + item.rarity.toLowerCase()
  const indexed = item.mods.map((m, i) => ({ m, i }))
  const impl = indexed.filter((x) => isImplicit(x.m))
  const expl = indexed.filter((x) => !isImplicit(x.m))
  const line = ({ m, i }: { m: ItemMod; i: number }) => (
    <ModLine key={i} m={m}>
      {selected && (
        <input type="checkbox" className="pick" checked={!!selected[i]} onChange={() => onToggle?.(i)} aria-label={m.text} />
      )}
    </ModLine>
  )
  return (
    <div className="item-card">
      <div className="item-head">
        <div>
          <div className={'iname ' + rarityCls}>{item.name}</div>
          {item.baseType !== item.name && <div className={rarityCls + ' small'}>{item.baseType}</div>}
        </div>
        {extra}
        {onClose && (
          <button className="ico" aria-label={t('item.close')} title={t('item.close')} onClick={onClose}>✕</button>
        )}
      </div>
      <div className="muted small">
        {item.slot ? t(`s.${item.slot}` as never) : item.itemClass}
        {item.itemLevel ? ` · ${t('item.ilvl')} ${item.itemLevel}` : ''}
        {item.corrupted ? ` · ${t('item.corrupted')}` : ''}
      </div>
      <PropsBlock p={item.props ?? {}} t={t} />
      {!hideMods && (
        <>
          {impl.length > 0 && <ul className="mods implicit">{impl.map(line)}</ul>}
          {impl.length > 0 && expl.length > 0 && <hr className="sep" />}
          {expl.length > 0 && <ul className="mods">{expl.map(line)}</ul>}
        </>
      )}
    </div>
  )
}
