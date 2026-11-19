import type { ParsedItem } from '../../shared/types'
import type { T } from './i18n'

export function ItemCard({ item, t, onClose }: { item: ParsedItem; t: T; onClose?: () => void }) {
  const rarityCls = 'r-' + item.rarity.toLowerCase()
  return (
    <div className="item-card">
      <div className="item-head">
        <div>
          <div className={'iname ' + rarityCls}>{item.name}</div>
          {item.baseType !== item.name && <div className={rarityCls + ' small'}>{item.baseType}</div>}
        </div>
        {onClose && (
          <button className="ico" aria-label={t('item.close')} title={t('item.close')} onClick={onClose}>✕</button>
        )}
      </div>
      <div className="muted small">
        {item.slot ? t(`s.${item.slot}` as never) : item.itemClass}
        {item.itemLevel ? ` · ${t('item.ilvl')} ${item.itemLevel}` : ''}
        {item.corrupted ? ` · ${t('item.corrupted')}` : ''}
      </div>
      {item.implicits.length > 0 && (
        <ul className="mods implicit">{item.implicits.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {item.mods.length > 0 && <ul className="mods">{item.mods.map((m, i) => <li key={i}>{m}</li>)}</ul>}
    </div>
  )
}
