import type { ExampleItem } from '../../shared/types'
import type { T } from './i18n'
import { fmtPrice } from './format'

/** 3–5 реальных лотов профиля; клик открывает предмет во вкладке «Крафт». */
export function Examples({ items, t, divine, onPick }: { items: ExampleItem[]; t: T; divine?: number; onPick: (e: ExampleItem) => void }) {
  if (!items.length) return null
  return (
    <div className="examples">
      <div className="lbl">{t('market.examples')}</div>
      {items.map((e, i) => (
        <button key={i} className="ex" onClick={() => onPick(e)} title={t('market.toCraft')}>
          <div className="ex-head">
            <span className={'iname r-' + e.rarity.toLowerCase()}>{e.name}</span>
            <span className="mono">{fmtPrice(e.priceDiv, divine)}</span>
          </div>
          <div className="muted small">
            {e.baseType}
            {e.ilvl ? ` · ilvl ${e.ilvl}` : ''}
            {e.corrupted ? ` · ${t('item.corrupted')}` : ''}
            {` · ${e.price}`}
          </div>
          <ul className="mods">
            {e.mods.map((m, j) => (
              <li key={j} className={'k-' + m.kind}>
                {m.tier && <span className="tier">{m.tier}</span>}
                {m.text}
              </li>
            ))}
          </ul>
        </button>
      ))}
    </div>
  )
}
