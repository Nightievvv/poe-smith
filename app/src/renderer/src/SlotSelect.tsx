import type { SlotId } from '../../shared/types'
import { SLOT_GROUPS, type T } from './i18n'

export function SlotSelect(p: { id: string; label: string; value: SlotId; onChange: (v: SlotId) => void; t: T }) {
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label}</label>
      <select id={p.id} value={p.value} onChange={(e) => p.onChange(e.target.value as SlotId)}>
        {SLOT_GROUPS.map(([g, slots]) => (
          <optgroup key={g} label={p.t(g)}>
            {slots.map((s) => (
              <option key={s} value={s.slice(2)}>
                {p.t(s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
