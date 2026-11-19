import type { ParsedItem, SlotId } from '../types'

const CLASS_TO_SLOT: Record<string, SlotId> = {
  Helmets: 'helmet', 'Body Armours': 'body', Gloves: 'gloves', Boots: 'boots', Shields: 'shield', Quivers: 'quiver',
  Amulets: 'amulet', Rings: 'ring', Belts: 'belt',
  Wands: 'weapon1', Claws: 'weapon1', Daggers: 'weapon1', 'Rune Daggers': 'weapon1', 'One Hand Swords': 'weapon1',
  'Thrusting One Hand Swords': 'weapon1', 'One Hand Axes': 'weapon1', 'One Hand Maces': 'weapon1', Sceptres: 'weapon1',
  'Two Hand Swords': 'weapon2', 'Two Hand Axes': 'weapon2', 'Two Hand Maces': 'weapon2', Staves: 'weapon2', Warstaves: 'weapon2', Bows: 'weapon2',
  Jewels: 'jewel', 'Abyss Jewels': 'abyss',
  'Life Flasks': 'flask', 'Mana Flasks': 'flask', 'Hybrid Flasks': 'flask', 'Utility Flasks': 'flask'
}

const NOT_MODS = /^(Requirements|Sockets|Item Level|Quality|Level|Str|Dex|Int|Note|Armour|Evasion Rating|Energy Shield|Ward|Chance to Block|Physical Damage|Elemental Damage|Critical Strike Chance|Attacks per Second|Weapon Range|Stack Size|Limited to|Radius|Recovers|Consumes|Currently has|Lasts)\b/
const FLAGS = /^(Corrupted|Mirrored|Unidentified|Split|Synthesised Item|Fractured Item|Shaper Item|Elder Item|Crusader Item|Hunter Item|Redeemer Item|Warlord Item|Searing Exarch Item|Eater of Worlds Item)$/

/** Текст, который игра кладёт в буфер по Ctrl+C (или Ctrl+Alt+C — расширенный формат) на английском клиенте. */
export function parseItem(text: string): ParsedItem | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim())
  if (!lines[0]?.startsWith('Item Class:')) return null

  const sections: string[][] = [[]]
  for (const l of lines) {
    if (l === '--------') sections.push([])
    else if (l) sections[sections.length - 1].push(l)
  }
  const head = sections[0]
  const itemClass = head[0].slice('Item Class:'.length).trim()
  const rarity = (head.find((l) => l.startsWith('Rarity:')) ?? '').slice('Rarity:'.length).trim()
  const names = head.filter((l) => !l.startsWith('Item Class:') && !l.startsWith('Rarity:'))
  const name = names[0] ?? ''
  const baseType = names[names.length - 1] ?? ''

  const ilvlIdx = sections.findIndex((s) => s.some((l) => l.startsWith('Item Level:')))
  const ilvlLine = ilvlIdx >= 0 ? sections[ilvlIdx].find((l) => l.startsWith('Item Level:')) : undefined
  const itemLevel = ilvlLine ? Number(ilvlLine.replace(/\D+/g, '')) : null

  const implicits: string[] = []
  const mods: string[] = []
  let corrupted = false
  for (const s of sections.slice(ilvlIdx >= 0 ? ilvlIdx + 1 : 1)) {
    if (!s.length || NOT_MODS.test(s[0])) continue
    for (const raw of s) {
      if (FLAGS.test(raw)) {
        if (raw === 'Corrupted') corrupted = true
        continue
      }
      if (raw.startsWith('{') || raw.startsWith('(')) continue // подсказки расширенного формата
      const clean = raw.replace(/\((\d+(\.\d+)?)-(\d+(\.\d+)?)\)/g, '').replace(/\s+/g, ' ').trim()
      const tag = clean.match(/\((implicit|enchant|crafted|fractured|scourge|crucible)\)$/)?.[1]
      const line = clean.replace(/\s*\((implicit|enchant|crafted|fractured|scourge|crucible)\)$/, '')
      if (tag === 'implicit' || tag === 'enchant') implicits.push(line)
      else mods.push(line)
    }
  }

  let slot: SlotId | null = CLASS_TO_SLOT[itemClass] ?? null
  if (slot === 'jewel' && /Cluster Jewel/.test(baseType)) slot = 'cluster'
  return { itemClass, rarity, name, baseType, itemLevel, slot, implicits, mods, corrupted }
}

export interface ItemTotals {
  life: number
  eleRes: number
  chaosRes: number
  moveSpeed: number
  suppress: number
}

/** Грубый аналог псевдо-модов трейда: суммирует жизнь и сопротивления со всех строк. */
export function totals(item: ParsedItem): ItemTotals {
  const t: ItemTotals = { life: 0, eleRes: 0, chaosRes: 0, moveSpeed: 0, suppress: 0 }
  for (const l of [...item.implicits, ...item.mods]) {
    let m: RegExpMatchArray | null
    if ((m = l.match(/^\+(\d+) to maximum Life$/))) t.life += +m[1]
    else if ((m = l.match(/^\+(\d+)% to (Fire|Cold|Lightning) Resistance$/))) t.eleRes += +m[1]
    else if ((m = l.match(/^\+(\d+)% to all Elemental Resistances$/))) t.eleRes += 3 * +m[1]
    else if ((m = l.match(/^\+(\d+)% to (Fire|Cold|Lightning) and (Fire|Cold|Lightning) Resistances$/))) t.eleRes += 2 * +m[1]
    else if ((m = l.match(/^\+(\d+)% to (Fire|Cold|Lightning) and Chaos Resistances$/))) {
      t.eleRes += +m[1]
      t.chaosRes += +m[1]
    } else if ((m = l.match(/^\+(\d+)% to Chaos Resistance$/))) t.chaosRes += +m[1]
    else if ((m = l.match(/^(\d+)% increased Movement Speed$/))) t.moveSpeed += +m[1]
    else if ((m = l.match(/^\+(\d+)% chance to Suppress Spell Damage$/))) t.suppress += +m[1]
  }
  return t
}
