import type { ItemModData, ItemModGroup } from '../../shared/types'
import { loadCraftData } from './craftdata'
import { basePool } from './modinfo'

/**
 * Данные для генератора regex предметов (как раздел Items на poe.re): список баз и моды выбранной базы,
 * сгруппированные по типу мода, с тирами (T1 — лучший) и минимальным числом каждого тира.
 */
const CLASSES = new Set([
  'Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield', 'Quiver', 'Amulet', 'Ring', 'Belt', 'Jewel', 'Abyss Jewel',
  'One Hand Sword', 'Thrusting One Hand Sword', 'One Hand Axe', 'One Hand Mace', 'Sceptre', 'Dagger', 'Rune Dagger', 'Claw', 'Wand',
  'Two Hand Sword', 'Two Hand Axe', 'Two Hand Mace', 'Staff', 'Warstaff', 'Bow'
])

export async function itemBases(): Promise<{ name: string; itemClass: string }[]> {
  const d = await loadCraftData()
  const out: { name: string; itemClass: string }[] = []
  for (const [name, list] of d.bases) {
    const b = list[0]
    if (CLASSES.has(b.itemClass) && b.domain !== 'flask' && !/Talisman|Demigod|Breach Ring|Tribal|Vaal Ring/i.test(name)) out.push({ name, itemClass: b.itemClass })
  }
  return out.sort((a, b) => a.itemClass.localeCompare(b.itemClass) || a.name.localeCompare(b.name))
}

/** «[PlayerItemRarity|Item Rarity]» → «Item Rarity» */
const clean = (t: string) => t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
/** «+(80-89) to maximum Life» → «+# to maximum life» */
const tpl = (line: string) => line.replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)|-?\d+(?:\.\d+)?/g, '#').toLowerCase()

export async function itemMods(baseName: string): Promise<ItemModData | null> {
  const d = await loadCraftData()
  const base = d.bases.get(baseName)?.[0]
  if (!base) return null
  const pool = basePool(d, base)
  const groups = new Map<string, ItemModGroup>()
  for (const m of pool) {
    const key = `${m.gen}|${m.type}|${tpl(clean(m.text))}`
    const g = groups.get(key) ?? { id: key, gen: m.gen as 'prefix' | 'suffix', text: '', match: tpl(clean(m.text)).split('\n'), tiers: [] }
    const ranges = m.lines[0]?.ranges ?? []
    g.tiers.push({ text: clean(m.text), ilvl: m.reqLevel, min: ranges[0] ? Math.min(...ranges[0]) : null })
    groups.set(key, g)
  }
  const out = [...groups.values()]
  for (const g of out) {
    g.tiers.sort((a, b) => b.ilvl - a.ilvl)
    g.text = g.tiers[0].text.replace(/\n/g, ' / ')
  }
  out.sort((a, b) => (a.gen === b.gen ? a.text.localeCompare(b.text) : a.gen === 'prefix' ? -1 : 1))
  return { base: base.name, itemClass: base.itemClass, groups: out }
}
