import type { DamageType, ItemMod, ItemProps, ModKind, ParsedItem } from '../../shared/types'
import { computeDps, slotOfClass } from '../../shared/poe1/item'
import type { Listing, RawMod } from './trade'
import { fillCraftedGen } from './modinfo'

/** Трейд размечает ключевые слова: "[PlayerItemRarity|Item Rarity]" → "Item Rarity", "[Onslaught]" → "Onslaught". */
export const cleanMarkup = (s: string) => s.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')

const ELE_TYPE: Record<number, DamageType> = { 4: 'fire', 5: 'cold', 6: 'lightning' }

function mods(list: RawMod[] | undefined, kind: ModKind): ItemMod[] {
  return (list ?? []).map((m) => {
    if (typeof m === 'string') return { text: cleanMarkup(m), kind }
    const k: ModKind = m.flags?.crafted || m.domain === 'crafted' ? 'crafted' : m.flags?.fractured ? 'fractured' : kind
    const tier = m.mods?.[0]?.tier
    const gen = tier?.startsWith('P') ? 'prefix' : tier?.startsWith('S') ? 'suffix' : undefined
    return { text: cleanMarkup(m.description), tier: tier || undefined, gen, affix: m.mods?.[0]?.name || undefined, kind: k }
  })
}

type Prop = { name: string; values: [string, number][] }

const nums = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

function props(it: Listing['item']): ItemProps {
  const p: ItemProps = {}
  const w: Parameters<typeof computeDps>[0] = { ele: [] }
  let isWeapon = false
  const def: NonNullable<ItemProps['defence']> = {}
  for (const pr of (it.properties ?? []) as Prop[]) {
    const name = cleanMarkup(pr.name)
    const v = pr.values?.[0]?.[0] ?? ''
    if (name.startsWith('Quality')) p.quality = nums(v)[0]
    else if (name === 'Physical Damage') { const [a, b] = nums(v); w.phys = [a, b]; isWeapon = true }
    else if (name === 'Elemental Damage') {
      isWeapon = true
      for (const [val, type] of pr.values) { const [a, b] = nums(val); w.ele.push({ type: ELE_TYPE[type] ?? 'ele', min: a, max: b }) }
    } else if (name === 'Chaos Damage') { const [a, b] = nums(v); w.chaos = [a, b]; isWeapon = true }
    else if (name === 'Critical Strike Chance') w.crit = nums(v)[0]
    else if (name === 'Attacks per Second') w.aps = nums(v)[0]
    else if (name === 'Armour') def.ar = nums(v)[0]
    else if (name === 'Evasion Rating') def.ev = nums(v)[0]
    else if (name === 'Energy Shield') def.es = nums(v)[0]
    else if (name === 'Ward') def.ward = nums(v)[0]
    else if (name === 'Chance to Block') def.block = nums(v)[0]
  }
  if (isWeapon) p.weapon = computeDps(w)
  if (Object.keys(def).length) p.defence = def
  const req: NonNullable<ItemProps['req']> = {}
  for (const r of (it.requirements ?? []) as Prop[]) {
    const n = cleanMarkup(r.name).toLowerCase()
    const v = nums(r.values?.[0]?.[0] ?? '')[0]
    if (n === 'level') req.level = v
    else if (n.startsWith('str')) req.str = v
    else if (n.startsWith('dex')) req.dex = v
    else if (n.startsWith('int')) req.int = v
  }
  if (Object.keys(req).length) p.req = req
  if (it.sockets?.length) {
    const groups = new Map<number, string[]>()
    for (const s of it.sockets) groups.set(s.group, [...(groups.get(s.group) ?? []), s.sColour])
    const g = [...groups.values()]
    p.sockets = { count: it.sockets.length, links: Math.max(...g.map((x) => x.length)), text: g.map((x) => x.join('-')).join(' ') }
  }
  return p
}

/** Класс предмета трейд не отдаёт: слот подставляет вызывающий код, а планировщик крафта берёт класс по базе из данных игры. */
export function listingToItem(l: Listing, slot: ParsedItem['slot'] = null): ParsedItem {
  const it = l.item
  return fillCraftedGen({
    itemClass: '',
    rarity: it.rarity ?? 'Rare',
    name: cleanMarkup(it.name || it.typeLine),
    baseType: it.baseType,
    itemLevel: it.ilvl ?? null,
    slot: slot ?? slotOfClass('', it.baseType),
    corrupted: !!it.corrupted,
    props: props(it),
    mods: [
      ...mods(it.enchantMods, 'enchant'),
      ...mods(it.implicitMods, 'implicit'),
      ...mods(it.fracturedMods, 'fractured'),
      ...mods(it.explicitMods, 'explicit'),
      ...mods(it.craftedMods, 'crafted')
    ]
  })
}
