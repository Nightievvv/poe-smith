import type { I18nText, SlotId } from '../types'

/** Ограничение на защиту брони: min 1 — свойство обязательно, max 0 — его не должно быть. */
export type DefenceFilter = Partial<Record<'ar' | 'ev' | 'es', { min?: number; max?: number }>>

export interface Subtype {
  id: string
  name: I18nText
  /** категория трейда; если не задана — категория слота */
  category?: string
  /** конкретная база */
  type?: string
  defence?: DefenceFilter
}

export const SLOT_CATEGORY: Record<SlotId, string> = {
  helmet: 'armour.helmet', body: 'armour.chest', gloves: 'armour.gloves', boots: 'armour.boots', shield: 'armour.shield',
  quiver: 'armour.quiver', amulet: 'accessory.amulet', ring: 'accessory.ring', belt: 'accessory.belt',
  weapon1: 'weapon.one', weapon2: 'weapon.twomelee', jewel: 'jewel.base', abyss: 'jewel.abyss', cluster: 'jewel.cluster', flask: 'flask'
}

const ANY: Subtype = { id: 'any', name: { ru: 'Любой', en: 'Any' } }
const has = { min: 1 }
const none = { max: 0 }

const DEFENCE: Subtype[] = [
  { id: 'any', name: { ru: 'Любая защита', en: 'Any defence' } },
  { id: 'es', name: { ru: 'Энергощит', en: 'Energy Shield' }, defence: { es: has, ar: none, ev: none } },
  { id: 'ar', name: { ru: 'Броня', en: 'Armour' }, defence: { ar: has, ev: none, es: none } },
  { id: 'ev', name: { ru: 'Уклонение', en: 'Evasion' }, defence: { ev: has, ar: none, es: none } },
  { id: 'ev_es', name: { ru: 'ES / Уклонение', en: 'ES / Evasion' }, defence: { es: has, ev: has, ar: none } },
  { id: 'ar_es', name: { ru: 'ES / Броня', en: 'ES / Armour' }, defence: { es: has, ar: has, ev: none } },
  { id: 'ar_ev', name: { ru: 'Броня / Уклонение', en: 'Armour / Evasion' }, defence: { ar: has, ev: has, es: none } }
]

export const SUBTYPES: Record<SlotId, Subtype[]> = {
  helmet: DEFENCE, body: DEFENCE, gloves: DEFENCE, boots: DEFENCE, shield: DEFENCE,
  quiver: [ANY], amulet: [ANY], ring: [ANY], belt: [ANY],
  weapon1: [
    { id: 'any', name: { ru: 'Любое одноручное', en: 'Any one-handed' } },
    { id: 'wand', name: { ru: 'Волшебные палочки', en: 'Wands' }, category: 'weapon.wand' },
    { id: 'dagger', name: { ru: 'Кинжалы', en: 'Daggers' }, category: 'weapon.dagger' },
    { id: 'claw', name: { ru: 'Когти', en: 'Claws' }, category: 'weapon.claw' },
    { id: 'sword', name: { ru: 'Одноручные мечи', en: 'One-hand swords' }, category: 'weapon.onesword' },
    { id: 'axe', name: { ru: 'Одноручные топоры', en: 'One-hand axes' }, category: 'weapon.oneaxe' },
    { id: 'mace', name: { ru: 'Одноручные булавы', en: 'One-hand maces' }, category: 'weapon.basemace' },
    { id: 'sceptre', name: { ru: 'Скипетры', en: 'Sceptres' }, category: 'weapon.sceptre' }
  ],
  weapon2: [
    { id: 'melee', name: { ru: 'Любое двуручное ближнего боя', en: 'Any two-handed melee' }, category: 'weapon.twomelee' },
    { id: 'sword', name: { ru: 'Двуручные мечи', en: 'Two-hand swords' }, category: 'weapon.twosword' },
    { id: 'axe', name: { ru: 'Двуручные топоры', en: 'Two-hand axes' }, category: 'weapon.twoaxe' },
    { id: 'mace', name: { ru: 'Двуручные булавы', en: 'Two-hand maces' }, category: 'weapon.twomace' },
    { id: 'staff', name: { ru: 'Посохи', en: 'Staves' }, category: 'weapon.staff' },
    { id: 'bow', name: { ru: 'Луки', en: 'Bows' }, category: 'weapon.bow' }
  ],
  jewel: [
    ANY,
    { id: 'crimson', name: { ru: 'Багровый (сила)', en: 'Crimson (Str)' }, type: 'Crimson Jewel' },
    { id: 'viridian', name: { ru: 'Изумрудный (ловкость)', en: 'Viridian (Dex)' }, type: 'Viridian Jewel' },
    { id: 'cobalt', name: { ru: 'Кобальтовый (интеллект)', en: 'Cobalt (Int)' }, type: 'Cobalt Jewel' }
  ],
  abyss: [
    ANY,
    { id: 'murderous', name: { ru: 'Murderous Eye (ближний бой)', en: 'Murderous Eye (melee)' }, type: 'Murderous Eye Jewel' },
    { id: 'searching', name: { ru: 'Searching Eye (дальний бой)', en: 'Searching Eye (ranged)' }, type: 'Searching Eye Jewel' },
    { id: 'hypnotic', name: { ru: 'Hypnotic Eye (чары)', en: 'Hypnotic Eye (spells)' }, type: 'Hypnotic Eye Jewel' },
    { id: 'ghastly', name: { ru: 'Ghastly Eye (приспешники)', en: 'Ghastly Eye (minions)' }, type: 'Ghastly Eye Jewel' }
  ],
  cluster: [
    { id: 'large', name: { ru: 'Большой', en: 'Large' }, type: 'Large Cluster Jewel' },
    { id: 'medium', name: { ru: 'Средний', en: 'Medium' }, type: 'Medium Cluster Jewel' },
    { id: 'small', name: { ru: 'Малый', en: 'Small' }, type: 'Small Cluster Jewel' }
  ],
  flask: [
    { id: 'life', name: { ru: 'Здоровье', en: 'Life' }, type: 'Divine Life Flask' },
    { id: 'mana', name: { ru: 'Мана', en: 'Mana' }, type: 'Divine Mana Flask' },
    { id: 'hybrid', name: { ru: 'Гибридный', en: 'Hybrid' }, type: 'Hallowed Hybrid Flask' },
    { id: 'utility', name: { ru: 'Утилити', en: 'Utility' } }
  ]
}

export const subtypeOf = (slot: SlotId, id: string): Subtype => SUBTYPES[slot].find((s) => s.id === id) ?? SUBTYPES[slot][0]
