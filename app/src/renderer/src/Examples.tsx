import type { ExampleItem } from '../../shared/types'
import type { T } from './i18n'
import { fmtPrice } from './format'
import { ItemCard } from './ItemCard'

/** 3–5 реальных лотов профиля; кнопка открывает предмет во вкладке «Крафт». */
export function Examples({ items, t, divine, onPick }: { items: ExampleItem[]; t: T; divine?: number; onPick: (e: ExampleItem) => void }) {
  if (!items.length) return null
  return (
    <div className="examples">
      <div className="lbl">{t('market.examples')}</div>
      {items.map((e, i) => (
        <div key={i} className="ex">
          <ItemCard
            item={e}
            t={t}
            extra={
              <div className="ex-price">
                <b className="mono">{fmtPrice(e.priceDiv, divine)}</b>
                <span className="muted small">{e.price}</span>
                <button className="btn" onClick={() => onPick(e)}>{t('market.toCraft')}</button>
              </div>
            }
          />
        </div>
      ))}
    </div>
  )
}
