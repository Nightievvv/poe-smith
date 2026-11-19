import type { I18nText, SlotId } from '../../shared/types'

/**
 * Профиль — «типичный ходовой предмет»: минимальные значения ключевых модов.
 * Категория и база берутся из выбранного типа предмета (shared/poe1/catalog.ts), профиль их только уточняет.
 * id модов — из https://www.pathofexile.com/api/trade/data/stats (стабильные хэши).
 */
export const STAT = {
  life: 'pseudo.pseudo_total_life',
  mana: 'pseudo.pseudo_total_mana',
  es: 'pseudo.pseudo_total_energy_shield',
  eleRes: 'pseudo.pseudo_total_elemental_resistance',
  chaosRes: 'pseudo.pseudo_total_chaos_resistance',
  str: 'pseudo.pseudo_total_strength',
  moveSpeed: 'pseudo.pseudo_increased_movement_speed',
  attackSpeed: 'pseudo.pseudo_total_attack_speed',
  castSpeed: 'pseudo.pseudo_total_cast_speed',
  spellDamage: 'pseudo.pseudo_increased_spell_damage',
  spellCrit: 'pseudo.pseudo_critical_strike_chance_for_spells',
  suppress: 'explicit.stat_3680664274',
  allGems: 'explicit.stat_4283407333',
  spellGems: 'explicit.stat_124131830',
  critMulti: 'explicit.stat_3556824919',
  lifePct: 'explicit.stat_983749596',
  clusterPassives: 'enchant.stat_3086156145'
} as const

type Stat = { id: string; min?: number; max?: number }

export interface Profile {
  id: string
  slot: SlotId
  name: I18nText
  rarity?: 'rare' | 'magic'
  type?: string
  stats?: Stat[]
  pdps?: number
  edps?: number
  crit?: number
  ilvl?: number
  quality?: number
  /** минимальные значения защиты самой вещи */
  defence?: Partial<Record<'ar' | 'ev' | 'es', number>>
  recipe?: string
  /** для каких типов предмета профиль имеет смысл (id из catalog.ts); не задано — для всех */
  only?: string[]
}

const s = (id: string, min?: number, max?: number): Stat => ({ id, min, max })
const n = (ru: string, en: string): I18nText => ({ ru, en })

// ---------- броня ----------
interface ArmourT { L1: number; R1: number; L2: number; R2: number; L3: number; R3: number; S: number; ES: number; AR: number; EV: number }
const ARM: Record<'helmet' | 'body' | 'gloves' | 'boots' | 'shield', ArmourT> = {
  helmet: { L1: 80, R1: 80, L2: 70, R2: 60, L3: 100, R3: 100, S: 12, ES: 250, AR: 600, EV: 600 },
  body: { L1: 100, R1: 80, L2: 90, R2: 60, L3: 120, R3: 100, S: 15, ES: 450, AR: 1500, EV: 1500 },
  gloves: { L1: 70, R1: 70, L2: 60, R2: 50, L3: 90, R3: 90, S: 10, ES: 180, AR: 400, EV: 400 },
  boots: { L1: 70, R1: 60, L2: 60, R2: 50, L3: 90, R3: 90, S: 10, ES: 180, AR: 400, EV: 400 },
  shield: { L1: 80, R1: 80, L2: 70, R2: 60, L3: 100, R3: 100, S: 10, ES: 250, AR: 800, EV: 800 }
}
const WITH_ES = ['any', 'es', 'ev_es', 'ar_es']
const WITH_AR = ['any', 'ar', 'ar_es', 'ar_ev']
const WITH_EV = ['any', 'ev', 'ev_es', 'ar_ev']

function armour(slot: keyof typeof ARM, extras: Omit<Profile, 'slot'>[]): Profile[] {
  const t = ARM[slot]
  const generic: Omit<Profile, 'slot'>[] = [
    { id: 'life-res', name: n(`Жизнь ${t.L1}+ · стих. сопр. ${t.R1}+`, `Life ${t.L1}+ · ele res ${t.R1}+`), stats: [s(STAT.life, t.L1), s(STAT.eleRes, t.R1)],
      recipe: slot === 'body' ? 'greed' : undefined },
    { id: 'life-chaos', name: n(`Жизнь ${t.L2}+ · хаос 25+ · стих. ${t.R2}+`, `Life ${t.L2}+ · chaos 25+ · ele ${t.R2}+`), stats: [s(STAT.life, t.L2), s(STAT.chaosRes, 25), s(STAT.eleRes, t.R2)] },
    { id: 'life-supp', name: n(`Жизнь ${t.L2}+ · подавление ${t.S}%+`, `Life ${t.L2}+ · suppression ${t.S}%+`), stats: [s(STAT.life, t.L2), s(STAT.suppress, t.S)], only: WITH_EV },
    { id: 'es-res', name: n(`Энергощит ${t.ES}+ · стих. ${t.R2}+`, `Energy shield ${t.ES}+ · ele ${t.R2}+`), defence: { es: t.ES }, stats: [s(STAT.eleRes, t.R2)], only: WITH_ES },
    { id: 'ar-life', name: n(`Броня ${t.AR}+ · жизнь ${t.L2}+`, `Armour ${t.AR}+ · life ${t.L2}+`), defence: { ar: t.AR }, stats: [s(STAT.life, t.L2)], only: WITH_AR },
    { id: 'ev-life', name: n(`Уклонение ${t.EV}+ · жизнь ${t.L2}+`, `Evasion ${t.EV}+ · life ${t.L2}+`), defence: { ev: t.EV }, stats: [s(STAT.life, t.L2)], only: WITH_EV },
    { id: 'life-high', name: n(`Жизнь ${t.L3}+`, `Life ${t.L3}+`), stats: [s(STAT.life, t.L3)] },
    { id: 'res-high', name: n(`Стихийные сопр. ${t.R3}+`, `Ele res ${t.R3}+`), stats: [s(STAT.eleRes, t.R3)] }
  ]
  return [...extras, ...generic].map((p) => ({ ...p, id: `${slot}-${p.id}`, slot }))
}

// ---------- бижутерия и колчан ----------
const jewellery = (slot: SlotId, list: Omit<Profile, 'slot'>[]): Profile[] => list.map((p) => ({ ...p, id: `${slot}-${p.id}`, slot }))

// ---------- оружие ----------
const MELEE1 = ['any', 'dagger', 'claw', 'sword', 'axe', 'mace', 'sceptre']
const SPELL1 = ['any', 'wand', 'dagger', 'sceptre']
const MELEE2 = ['melee', 'sword', 'axe', 'mace']

export const PROFILES: Profile[] = [
  ...armour('helmet', []),
  ...armour('body', []),
  ...armour('gloves', [
    { id: 'life-as', name: n('Жизнь 60+ · скорость атаки 10%+ · стих. 50+', 'Life 60+ · attack speed 10%+ · ele 50+'),
      stats: [s(STAT.life, 60), s(STAT.attackSpeed, 10), s(STAT.eleRes, 50)] }
  ]),
  ...armour('boots', [
    { id: 'ms-life-res', name: n('Скорость 30% · жизнь 70+ · стих. 60+', 'Move speed 30% · life 70+ · ele 60+'), recipe: 'ms',
      stats: [s(STAT.moveSpeed, 30), s(STAT.life, 70), s(STAT.eleRes, 60)] },
    { id: 'ms-supp', name: n('Скорость 30% · подавление 10%+ · жизнь 60+', 'Move speed 30% · suppression 10%+ · life 60+'), only: WITH_EV,
      stats: [s(STAT.moveSpeed, 30), s(STAT.suppress, 10), s(STAT.life, 60)] },
    { id: 'ms-chaos', name: n('Скорость 30% · хаос 25+ · жизнь 60+', 'Move speed 30% · chaos 25+ · life 60+'),
      stats: [s(STAT.moveSpeed, 30), s(STAT.chaosRes, 25), s(STAT.life, 60)] }
  ]),
  ...armour('shield', [
    { id: 'spell', name: n('Урон чарами 60%+ · жизнь 50+', 'Spell damage 60%+ · life 50+'), only: WITH_ES,
      stats: [s(STAT.spellDamage, 60), s(STAT.life, 50)] }
  ]),

  ...jewellery('amulet', [
    { id: 'gems', name: n('+1 ко всем камням · жизнь 50+', '+1 to all skill gems · life 50+'), stats: [s(STAT.allGems, 1), s(STAT.life, 50)] },
    { id: 'crit', name: n('Жизнь 60+ · крит. множитель 25%+ · стих. 40+', 'Life 60+ · crit multi 25%+ · ele 40+'), stats: [s(STAT.life, 60), s(STAT.critMulti, 25), s(STAT.eleRes, 40)] },
    { id: 'life-res', name: n('Жизнь 60+ · стих. сопр. 80+', 'Life 60+ · ele res 80+'), stats: [s(STAT.life, 60), s(STAT.eleRes, 80)] },
    { id: 'life-chaos', name: n('Жизнь 50+ · стих. 60+ · хаос 20+', 'Life 50+ · ele 60+ · chaos 20+'), stats: [s(STAT.life, 50), s(STAT.eleRes, 60), s(STAT.chaosRes, 20)] },
    { id: 'es', name: n('Энергощит 50+ · стих. 40+', 'Energy shield 50+ · ele 40+'), stats: [s(STAT.es, 50), s(STAT.eleRes, 40)] },
    { id: 'spell', name: n('Урон чарами 25%+ · жизнь 40+', 'Spell damage 25%+ · life 40+'), stats: [s(STAT.spellDamage, 25), s(STAT.life, 40)] },
    { id: 'life-high', name: n('Жизнь 80+', 'Life 80+'), stats: [s(STAT.life, 80)] }
  ]),
  ...jewellery('ring', [
    { id: 'life-res', name: n('Жизнь 60+ · стих. сопр. 80+', 'Life 60+ · ele res 80+'), stats: [s(STAT.life, 60), s(STAT.eleRes, 80)] },
    { id: 'life-chaos', name: n('Жизнь 50+ · стих. 60+ · хаос 20+', 'Life 50+ · ele 60+ · chaos 20+'), stats: [s(STAT.life, 50), s(STAT.eleRes, 60), s(STAT.chaosRes, 20)] },
    { id: 'res-high', name: n('Стихийные сопр. 100+', 'Ele res 100+'), stats: [s(STAT.eleRes, 100)] },
    { id: 'life-high', name: n('Жизнь 70+', 'Life 70+'), stats: [s(STAT.life, 70)] },
    { id: 'life-es', name: n('Жизнь 50+ · энергощит 40+', 'Life 50+ · energy shield 40+'), stats: [s(STAT.life, 50), s(STAT.es, 40)] },
    { id: 'life-mana', name: n('Жизнь 50+ · мана 50+', 'Life 50+ · mana 50+'), stats: [s(STAT.life, 50), s(STAT.mana, 50)] },
    { id: 'life-as', name: n('Жизнь 50+ · скорость атаки 5%+', 'Life 50+ · attack speed 5%+'), stats: [s(STAT.life, 50), s(STAT.attackSpeed, 5)] }
  ]),
  ...jewellery('belt', [
    { id: 'life-res', name: n('Жизнь 90+ · стих. сопр. 70+', 'Life 90+ · ele res 70+'), stats: [s(STAT.life, 90), s(STAT.eleRes, 70)] },
    { id: 'life-chaos', name: n('Жизнь 80+ · стих. 60+ · хаос 20+', 'Life 80+ · ele 60+ · chaos 20+'), stats: [s(STAT.life, 80), s(STAT.eleRes, 60), s(STAT.chaosRes, 20)] },
    { id: 'life-high', name: n('Жизнь 110+', 'Life 110+'), stats: [s(STAT.life, 110)] },
    { id: 'res-high', name: n('Стихийные сопр. 100+', 'Ele res 100+'), stats: [s(STAT.eleRes, 100)] },
    { id: 'life-str', name: n('Жизнь 80+ · сила 40+', 'Life 80+ · strength 40+'), stats: [s(STAT.life, 80), s(STAT.str, 40)] },
    { id: 'es-res', name: n('Энергощит 40+ · стих. 60+', 'Energy shield 40+ · ele 60+'), stats: [s(STAT.es, 40), s(STAT.eleRes, 60)] }
  ]),
  ...jewellery('quiver', [
    { id: 'life-crit', name: n('Жизнь 70+ · крит. множитель 25%+', 'Life 70+ · crit multi 25%+'), stats: [s(STAT.life, 70), s(STAT.critMulti, 25)] },
    { id: 'life-res', name: n('Жизнь 70+ · стих. 60+', 'Life 70+ · ele 60+'), stats: [s(STAT.life, 70), s(STAT.eleRes, 60)] },
    { id: 'life-high', name: n('Жизнь 90+', 'Life 90+'), stats: [s(STAT.life, 90)] },
    { id: 'crit-high', name: n('Крит. множитель 35%+', 'Crit multi 35%+'), stats: [s(STAT.critMulti, 35)] },
    { id: 'life-as', name: n('Жизнь 60+ · скорость атаки 8%+', 'Life 60+ · attack speed 8%+'), stats: [s(STAT.life, 60), s(STAT.attackSpeed, 8)] }
  ]),

  ...jewellery('weapon1', [
    { id: 'spell-gems', name: n('+1 к чарам · урон чарами 60%+', '+1 spell gems · spell damage 60%+'), only: SPELL1, stats: [s(STAT.spellGems, 1), s(STAT.spellDamage, 60)] },
    { id: 'pdps-400', name: n('Физ. DPS 400+', 'Physical DPS 400+'), only: MELEE1, pdps: 400 },
    { id: 'spell-90', name: n('Урон чарами 90%+', 'Spell damage 90%+'), only: SPELL1, stats: [s(STAT.spellDamage, 90)] },
    { id: 'pdps-300', name: n('Физ. DPS 300+', 'Physical DPS 300+'), only: MELEE1, pdps: 300 },
    { id: 'edps-250', name: n('Стихийный DPS 250+', 'Elemental DPS 250+'), only: MELEE1, edps: 250 },
    { id: 'pdps-500', name: n('Физ. DPS 500+', 'Physical DPS 500+'), only: MELEE1, pdps: 500 },
    { id: 'crit-pdps', name: n('Крит. шанс 7%+ · физ. DPS 300+', 'Crit chance 7%+ · pDPS 300+'), only: MELEE1, crit: 7, pdps: 300 },
    { id: 'spell-crit', name: n('Урон чарами 50%+ · крит. чар 80%+', 'Spell damage 50%+ · spell crit 80%+'), only: SPELL1, stats: [s(STAT.spellDamage, 50), s(STAT.spellCrit, 80)] },
    { id: 'spell-cast', name: n('Урон чарами 50%+ · скорость чар 15%+', 'Spell damage 50%+ · cast speed 15%+'), only: SPELL1, stats: [s(STAT.spellDamage, 50), s(STAT.castSpeed, 15)] }
  ]),
  ...jewellery('weapon2', [
    { id: 'pdps-550', name: n('Физ. DPS 550+', 'Physical DPS 550+'), only: MELEE2, pdps: 550 },
    { id: 'pdps-450', name: n('Физ. DPS 450+', 'Physical DPS 450+'), only: MELEE2, pdps: 450 },
    { id: 'pdps-650', name: n('Физ. DPS 650+', 'Physical DPS 650+'), only: MELEE2, pdps: 650 },
    { id: 'edps-350', name: n('Стихийный DPS 350+', 'Elemental DPS 350+'), only: MELEE2, edps: 350 },
    { id: 'crit-pdps', name: n('Крит. шанс 6%+ · физ. DPS 450+', 'Crit chance 6%+ · pDPS 450+'), only: MELEE2, crit: 6, pdps: 450 },
    { id: 'staff-gems', name: n('+2 к чарам', '+2 spell gems'), only: ['staff'], stats: [s(STAT.spellGems, 2)] },
    { id: 'staff-spell', name: n('Урон чарами 100%+', 'Spell damage 100%+'), only: ['staff'], stats: [s(STAT.spellDamage, 100)] },
    { id: 'staff-gems1', name: n('+1 к чарам · урон чарами 60%+', '+1 spell gems · spell damage 60%+'), only: ['staff'], stats: [s(STAT.spellGems, 1), s(STAT.spellDamage, 60)] },
    { id: 'staff-pdps', name: n('Физ. DPS 400+', 'Physical DPS 400+'), only: ['staff'], pdps: 400 },
    { id: 'staff-cast', name: n('Скорость чар 20%+', 'Cast speed 20%+'), only: ['staff'], stats: [s(STAT.castSpeed, 20)] },
    { id: 'bow-pdps-350', name: n('Физ. DPS 350+', 'Physical DPS 350+'), only: ['bow'], pdps: 350 },
    { id: 'bow-pdps-450', name: n('Физ. DPS 450+', 'Physical DPS 450+'), only: ['bow'], pdps: 450 },
    { id: 'bow-edps', name: n('Стихийный DPS 300+', 'Elemental DPS 300+'), only: ['bow'], edps: 300 },
    { id: 'bow-crit', name: n('Крит. шанс 7%+ · физ. DPS 300+', 'Crit chance 7%+ · pDPS 300+'), only: ['bow'], crit: 7, pdps: 300 },
    { id: 'bow-pdps-250', name: n('Физ. DPS 250+', 'Physical DPS 250+'), only: ['bow'], pdps: 250 }
  ]),

  ...jewellery('jewel', [
    { id: 'life-crit', name: n('% жизни 6+ · крит. множитель 10%+', '% life 6+ · crit multi 10%+'), recipe: 'jlife', stats: [s(STAT.lifePct, 6), s(STAT.critMulti, 10)] },
    { id: 'life-res', name: n('% жизни 5+ · стих. сопр. 20+', '% life 5+ · ele res 20+'), recipe: 'jlife', stats: [s(STAT.lifePct, 5), s(STAT.eleRes, 20)] },
    { id: 'life-high', name: n('% жизни 7+', '% life 7+'), stats: [s(STAT.lifePct, 7)] },
    { id: 'life-as', name: n('% жизни 5+ · скорость атаки 6%+', '% life 5+ · attack speed 6%+'), stats: [s(STAT.lifePct, 5), s(STAT.attackSpeed, 6)] },
    { id: 'life-cast', name: n('% жизни 5+ · скорость чар 5%+', '% life 5+ · cast speed 5%+'), stats: [s(STAT.lifePct, 5), s(STAT.castSpeed, 5)] },
    { id: 'crit-high', name: n('Крит. множитель 15%+', 'Crit multi 15%+'), stats: [s(STAT.critMulti, 15)] }
  ]),
  ...jewellery('abyss', [
    { id: 'life', name: n('Жизнь 50+', 'Life 50+'), stats: [s(STAT.life, 50)] },
    { id: 'life-res', name: n('Жизнь 40+ · стих. 20+', 'Life 40+ · ele 20+'), stats: [s(STAT.life, 40), s(STAT.eleRes, 20)] },
    { id: 'life-chaos', name: n('Жизнь 40+ · хаос 15+', 'Life 40+ · chaos 15+'), stats: [s(STAT.life, 40), s(STAT.chaosRes, 15)] },
    { id: 'es', name: n('Энергощит 30+', 'Energy shield 30+'), stats: [s(STAT.es, 30)] },
    { id: 'life-mana', name: n('Жизнь 35+ · мана 25+', 'Life 35+ · mana 25+'), stats: [s(STAT.life, 35), s(STAT.mana, 25)] }
  ]),
  ...jewellery('cluster', [
    { id: 'l8-84', name: n('8 пассивов · ilvl 84+', '8 passives · ilvl 84+'), only: ['large'], ilvl: 84, stats: [s(STAT.clusterPassives, 8, 8)] },
    { id: 'l8', name: n('8 пассивов · ilvl 75+', '8 passives · ilvl 75+'), only: ['large'], ilvl: 75, stats: [s(STAT.clusterPassives, 8, 8)] },
    { id: 'l9', name: n('9–10 пассивов', '9–10 passives'), only: ['large'], stats: [s(STAT.clusterPassives, 9, 10)] },
    { id: 'l11', name: n('11–12 пассивов', '11–12 passives'), only: ['large'], stats: [s(STAT.clusterPassives, 11, 12)] },
    { id: 'l-84', name: n('Любые · ilvl 84+', 'Any · ilvl 84+'), only: ['large'], ilvl: 84 },
    { id: 'm4-84', name: n('4 пассива · ilvl 84+', '4 passives · ilvl 84+'), only: ['medium'], ilvl: 84, stats: [s(STAT.clusterPassives, 4, 4)] },
    { id: 'm5-84', name: n('5 пассивов · ilvl 84+', '5 passives · ilvl 84+'), only: ['medium'], ilvl: 84, stats: [s(STAT.clusterPassives, 5, 5)] },
    { id: 'm4', name: n('4–5 пассивов · ilvl 68+', '4–5 passives · ilvl 68+'), only: ['medium'], ilvl: 68, stats: [s(STAT.clusterPassives, 4, 5)] },
    { id: 'm6', name: n('6 пассивов', '6 passives'), only: ['medium'], stats: [s(STAT.clusterPassives, 6, 6)] },
    { id: 'm-84', name: n('Любые · ilvl 84+', 'Any · ilvl 84+'), only: ['medium'], ilvl: 84 },
    { id: 's2-84', name: n('2 пассива · ilvl 84+', '2 passives · ilvl 84+'), only: ['small'], ilvl: 84, stats: [s(STAT.clusterPassives, 2, 2)] },
    { id: 's3-84', name: n('3 пассива · ilvl 84+', '3 passives · ilvl 84+'), only: ['small'], ilvl: 84, stats: [s(STAT.clusterPassives, 3, 3)] },
    { id: 's2', name: n('2 пассива · ilvl 68+', '2 passives · ilvl 68+'), only: ['small'], ilvl: 68, stats: [s(STAT.clusterPassives, 2, 2)] },
    { id: 's-84', name: n('Любые · ilvl 84+', 'Any · ilvl 84+'), only: ['small'], ilvl: 84 },
    { id: 's-75', name: n('Любые · ilvl 75+', 'Any · ilvl 75+'), only: ['small'], ilvl: 75 }
  ]),

  // флаконы в PoE 1 бывают только магическими
  ...jewellery('flask', [
    ...['life', 'mana', 'hybrid'].flatMap((st) => [
      { id: `${st}-q20`, name: n('Качество 20%+', 'Quality 20%+'), only: [st], rarity: 'magic' as const, quality: 20 },
      { id: `${st}-84`, name: n('ilvl 84+', 'ilvl 84+'), only: [st], rarity: 'magic' as const, ilvl: 84 },
      { id: `${st}-any`, name: n('Любой магический', 'Any magic'), only: [st], rarity: 'magic' as const },
      { id: `${st}-q20-84`, name: n('Качество 20%+ · ilvl 84+', 'Quality 20%+ · ilvl 84+'), only: [st], rarity: 'magic' as const, quality: 20, ilvl: 84 },
      { id: `${st}-q15`, name: n('Качество 15%+', 'Quality 15%+'), only: [st], rarity: 'magic' as const, quality: 15 }
    ]),
    ...['Quicksilver', 'Granite', 'Jade', 'Silver', 'Diamond', 'Basalt', 'Sulphur', 'Bismuth', 'Amethyst', 'Stibnite', 'Quartz', 'Gold'].map((b) => ({
      id: `util-${b.toLowerCase()}`, name: n(`${b} Flask`, `${b} Flask`), only: ['utility'], rarity: 'magic' as const, type: `${b} Flask`
    }))
  ])
]

export const profilesFor = (slot: SlotId, subtype: string) =>
  PROFILES.filter((p) => p.slot === slot && (!p.only || p.only.includes(subtype)))
