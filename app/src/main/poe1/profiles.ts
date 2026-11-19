import type { I18nText, SlotId } from '../../shared/types'

/**
 * Профиль — «типичный ходовой редкий предмет»: категория + минимальные значения ключевых модов.
 * id модов взяты из https://www.pathofexile.com/api/trade/data/stats (это стабильные хэши).
 */
export const STAT = {
  life: 'pseudo.pseudo_total_life',
  eleRes: 'pseudo.pseudo_total_elemental_resistance',
  chaosRes: 'pseudo.pseudo_total_chaos_resistance',
  moveSpeed: 'pseudo.pseudo_increased_movement_speed',
  attackSpeed: 'pseudo.pseudo_total_attack_speed',
  spellDamage: 'pseudo.pseudo_increased_spell_damage',
  suppress: 'explicit.stat_3680664274',
  allGems: 'explicit.stat_4283407333',
  spellGems: 'explicit.stat_124131830',
  critMulti: 'explicit.stat_3556824919',
  lifePct: 'explicit.stat_983749596',
  clusterPassives: 'enchant.stat_3086156145'
} as const

export interface Profile {
  id: string
  slot: SlotId
  name: I18nText
  category: string
  rarity: 'rare' | 'magic'
  /** конкретная база, если важна */
  type?: string
  stats?: { id: string; min?: number; max?: number }[]
  pdps?: number
  ilvl?: number
  recipe?: string
}

const p = (x: Profile) => x

export const PROFILES: Profile[] = [
  // ---- броня ----
  p({ id: 'helmet-life-res', slot: 'helmet', category: 'armour.helmet', rarity: 'rare',
    name: { ru: 'Жизнь 80+ · стихийные сопр. 80+', en: 'Life 80+ · ele res 80+' },
    stats: [{ id: STAT.life, min: 80 }, { id: STAT.eleRes, min: 80 }] }),
  p({ id: 'helmet-life-chaos', slot: 'helmet', category: 'armour.helmet', rarity: 'rare',
    name: { ru: 'Жизнь 70+ · сопр. хаосу 25+ · стих. 60+', en: 'Life 70+ · chaos res 25+ · ele 60+' },
    stats: [{ id: STAT.life, min: 70 }, { id: STAT.chaosRes, min: 25 }, { id: STAT.eleRes, min: 60 }] }),

  p({ id: 'body-life-res', slot: 'body', category: 'armour.chest', rarity: 'rare', recipe: 'greed',
    name: { ru: 'Жизнь 100+ · стихийные сопр. 80+', en: 'Life 100+ · ele res 80+' },
    stats: [{ id: STAT.life, min: 100 }, { id: STAT.eleRes, min: 80 }] }),
  p({ id: 'body-life-supp', slot: 'body', category: 'armour.chest', rarity: 'rare',
    name: { ru: 'Жизнь 90+ · подавление чар 15%+', en: 'Life 90+ · spell suppression 15%+' },
    stats: [{ id: STAT.life, min: 90 }, { id: STAT.suppress, min: 15 }] }),

  p({ id: 'gloves-life-res', slot: 'gloves', category: 'armour.gloves', rarity: 'rare',
    name: { ru: 'Жизнь 70+ · стихийные сопр. 70+', en: 'Life 70+ · ele res 70+' },
    stats: [{ id: STAT.life, min: 70 }, { id: STAT.eleRes, min: 70 }] }),
  p({ id: 'gloves-life-as', slot: 'gloves', category: 'armour.gloves', rarity: 'rare',
    name: { ru: 'Жизнь 60+ · скорость атаки 10%+ · стих. 50+', en: 'Life 60+ · attack speed 10%+ · ele 50+' },
    stats: [{ id: STAT.life, min: 60 }, { id: STAT.attackSpeed, min: 10 }, { id: STAT.eleRes, min: 50 }] }),

  p({ id: 'boots-ms-life-res', slot: 'boots', category: 'armour.boots', rarity: 'rare', recipe: 'ms',
    name: { ru: 'Скорость 30% · жизнь 70+ · стих. 60+', en: 'Move speed 30% · life 70+ · ele 60+' },
    stats: [{ id: STAT.moveSpeed, min: 30 }, { id: STAT.life, min: 70 }, { id: STAT.eleRes, min: 60 }] }),
  p({ id: 'boots-ms-supp', slot: 'boots', category: 'armour.boots', rarity: 'rare',
    name: { ru: 'Скорость 30% · подавление 10%+ · жизнь 60+', en: 'Move speed 30% · suppression 10%+ · life 60+' },
    stats: [{ id: STAT.moveSpeed, min: 30 }, { id: STAT.suppress, min: 10 }, { id: STAT.life, min: 60 }] }),

  p({ id: 'shield-life-res', slot: 'shield', category: 'armour.shield', rarity: 'rare',
    name: { ru: 'Жизнь 80+ · стихийные сопр. 80+', en: 'Life 80+ · ele res 80+' },
    stats: [{ id: STAT.life, min: 80 }, { id: STAT.eleRes, min: 80 }] }),
  p({ id: 'shield-spell', slot: 'shield', category: 'armour.shield', rarity: 'rare',
    name: { ru: 'Урон чарами 60%+ · жизнь 50+', en: 'Spell damage 60%+ · life 50+' },
    stats: [{ id: STAT.spellDamage, min: 60 }, { id: STAT.life, min: 50 }] }),

  p({ id: 'quiver-life-crit', slot: 'quiver', category: 'armour.quiver', rarity: 'rare',
    name: { ru: 'Жизнь 70+ · крит. множитель 25%+', en: 'Life 70+ · crit multi 25%+' },
    stats: [{ id: STAT.life, min: 70 }, { id: STAT.critMulti, min: 25 }] }),

  // ---- бижутерия ----
  p({ id: 'amulet-gems', slot: 'amulet', category: 'accessory.amulet', rarity: 'rare',
    name: { ru: '+1 ко всем камням · жизнь 50+', en: '+1 to all skill gems · life 50+' },
    stats: [{ id: STAT.allGems, min: 1 }, { id: STAT.life, min: 50 }] }),
  p({ id: 'amulet-crit', slot: 'amulet', category: 'accessory.amulet', rarity: 'rare',
    name: { ru: 'Жизнь 60+ · крит. множитель 25%+ · стих. 40+', en: 'Life 60+ · crit multi 25%+ · ele 40+' },
    stats: [{ id: STAT.life, min: 60 }, { id: STAT.critMulti, min: 25 }, { id: STAT.eleRes, min: 40 }] }),

  p({ id: 'ring-life-res', slot: 'ring', category: 'accessory.ring', rarity: 'rare',
    name: { ru: 'Жизнь 60+ · стихийные сопр. 80+', en: 'Life 60+ · ele res 80+' },
    stats: [{ id: STAT.life, min: 60 }, { id: STAT.eleRes, min: 80 }] }),
  p({ id: 'ring-life-chaos', slot: 'ring', category: 'accessory.ring', rarity: 'rare',
    name: { ru: 'Жизнь 50+ · стих. 60+ · хаос 20+', en: 'Life 50+ · ele 60+ · chaos 20+' },
    stats: [{ id: STAT.life, min: 50 }, { id: STAT.eleRes, min: 60 }, { id: STAT.chaosRes, min: 20 }] }),

  p({ id: 'belt-life-res', slot: 'belt', category: 'accessory.belt', rarity: 'rare',
    name: { ru: 'Жизнь 90+ · стихийные сопр. 70+', en: 'Life 90+ · ele res 70+' },
    stats: [{ id: STAT.life, min: 90 }, { id: STAT.eleRes, min: 70 }] }),
  p({ id: 'belt-life-chaos', slot: 'belt', category: 'accessory.belt', rarity: 'rare',
    name: { ru: 'Жизнь 80+ · стих. 60+ · хаос 20+', en: 'Life 80+ · ele 60+ · chaos 20+' },
    stats: [{ id: STAT.life, min: 80 }, { id: STAT.eleRes, min: 60 }, { id: STAT.chaosRes, min: 20 }] }),

  // ---- оружие ----
  p({ id: 'wand-spell', slot: 'weapon1', category: 'weapon.wand', rarity: 'rare',
    name: { ru: 'Жезл: +1 к чарам · урон чарами 60%+', en: 'Wand: +1 spell gems · spell damage 60%+' },
    stats: [{ id: STAT.spellGems, min: 1 }, { id: STAT.spellDamage, min: 60 }] }),
  p({ id: 'onehand-phys', slot: 'weapon1', category: 'weapon.onemelee', rarity: 'rare',
    name: { ru: 'Одноручное: физ. DPS 400+', en: 'One-hand melee: pDPS 400+' }, pdps: 400 }),
  p({ id: 'twohand-phys', slot: 'weapon2', category: 'weapon.twomelee', rarity: 'rare',
    name: { ru: 'Двуручное: физ. DPS 550+', en: 'Two-hand melee: pDPS 550+' }, pdps: 550 }),
  p({ id: 'bow-phys', slot: 'weapon2', category: 'weapon.bow', rarity: 'rare',
    name: { ru: 'Лук: физ. DPS 350+', en: 'Bow: pDPS 350+' }, pdps: 350 }),

  // ---- самоцветы ----
  p({ id: 'jewel-life-crit', slot: 'jewel', category: 'jewel.base', rarity: 'rare', recipe: 'jlife',
    name: { ru: '% жизни 6+ · крит. множитель 10%+', en: '% life 6+ · crit multi 10%+' },
    stats: [{ id: STAT.lifePct, min: 6 }, { id: STAT.critMulti, min: 10 }] }),
  p({ id: 'jewel-life-res', slot: 'jewel', category: 'jewel.base', rarity: 'rare', recipe: 'jlife',
    name: { ru: '% жизни 5+ · стих. сопр. 20+', en: '% life 5+ · ele res 20+' },
    stats: [{ id: STAT.lifePct, min: 5 }, { id: STAT.eleRes, min: 20 }] }),
  p({ id: 'abyss-life', slot: 'abyss', category: 'jewel.abyss', rarity: 'rare',
    name: { ru: 'Абиссальный: жизнь 45+', en: 'Abyss: life 45+' },
    stats: [{ id: STAT.life, min: 45 }] }),
  p({ id: 'cluster-large', slot: 'cluster', category: 'jewel.cluster', rarity: 'rare', ilvl: 84,
    name: { ru: 'Большой кластер: 8 пассивов, ilvl 84+', en: 'Large cluster: 8 passives, ilvl 84+' },
    stats: [{ id: STAT.clusterPassives, min: 8, max: 8 }] }),
  p({ id: 'cluster-medium', slot: 'cluster', category: 'jewel.cluster', rarity: 'rare', ilvl: 84,
    name: { ru: 'Средний кластер: 4–5 пассивов, ilvl 84+', en: 'Medium cluster: 4–5 passives, ilvl 84+' },
    stats: [{ id: STAT.clusterPassives, min: 4, max: 5 }] }),

  // ---- флаконы: в PoE 1 они бывают только магическими ----
  p({ id: 'flask-quicksilver', slot: 'flask', category: 'flask', rarity: 'magic', type: 'Quicksilver Flask',
    name: { ru: 'Quicksilver Flask (магический)', en: 'Quicksilver Flask (magic)' } }),
  p({ id: 'flask-granite', slot: 'flask', category: 'flask', rarity: 'magic', type: 'Granite Flask',
    name: { ru: 'Granite Flask (магический)', en: 'Granite Flask (magic)' } })
]

export const profilesFor = (slot: SlotId) => PROFILES.filter((x) => x.slot === slot)
