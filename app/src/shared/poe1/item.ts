import type { DamageType, ItemMod, ItemProps, ModKind, ParsedItem, SlotId } from '../types'

const CLASS_TO_SLOT: Record<string, SlotId> = {
  Helmets: 'helmet', 'Body Armours': 'body', Gloves: 'gloves', Boots: 'boots', Shields: 'shield', Quivers: 'quiver',
  Amulets: 'amulet', Rings: 'ring', Belts: 'belt',
  Wands: 'weapon1', Claws: 'weapon1', Daggers: 'weapon1', 'Rune Daggers': 'weapon1', 'One Hand Swords': 'weapon1',
  'Thrusting One Hand Swords': 'weapon1', 'One Hand Axes': 'weapon1', 'One Hand Maces': 'weapon1', Sceptres: 'weapon1',
  'Two Hand Swords': 'weapon2', 'Two Hand Axes': 'weapon2', 'Two Hand Maces': 'weapon2', Staves: 'weapon2', Warstaves: 'weapon2', Bows: 'weapon2',
  Jewels: 'jewel', 'Abyss Jewels': 'abyss',
  'Life Flasks': 'flask', 'Mana Flasks': 'flask', 'Hybrid Flasks': 'flask', 'Utility Flasks': 'flask'
}

export const slotOfClass = (itemClass: string, baseType: string): SlotId | null => {
  let slot: SlotId | null = CLASS_TO_SLOT[itemClass] ?? null
  if (slot === 'jewel' && /Cluster Jewel/.test(baseType)) slot = 'cluster'
  return slot
}

const FLAGS = /^(Corrupted|Mirrored|Unidentified|Split|Synthesised Item|Fractured Item|Shaper Item|Elder Item|Crusader Item|Hunter Item|Redeemer Item|Warlord Item|Searing Exarch Item|Eater of Worlds Item|Unmodifiable|Imbued)$/
const PROP_SECTION = /^(Requirements|Requires|Sockets|Quality|Physical Damage|Elemental Damage|Chaos Damage|Critical Strike Chance|Attacks per Second|Weapon Range|Armour|Evasion Rating|Energy Shield|Ward|Chance to Block|Level|Str|Dex|Int|Stack Size|Limited to|Radius|Recovers|Consumes|Currently has|Lasts|Note|Item Level)\b/
/** подсказки по использованию предмета — это не моды */
const USAGE = /^(Right click|Place into|Can only hold charges|Travel to this|Shift click|Use this)/
const TAG_RE = /\s*\((implicit|enchant|crafted|fractured|scourge|crucible)\)$/

const num = (s: string) => Number(s.replace(/[^\d.]/g, ''))
const range = (s: string): [number, number] | undefined => {
  const m = s.match(/(\d+)-(\d+)/)
  return m ? [+m[1], +m[2]] : undefined
}

export function computeDps(w: Omit<NonNullable<ItemProps['weapon']>, 'pdps' | 'edps' | 'cdps' | 'dps'>): NonNullable<ItemProps['weapon']> {
  const aps = w.aps ?? 0
  const avg = (r?: [number, number]) => (r ? (r[0] + r[1]) / 2 : 0)
  const pdps = avg(w.phys) * aps
  const edps = w.ele.reduce((a, e) => a + ((e.min + e.max) / 2) * aps, 0)
  const cdps = avg(w.chaos) * aps
  const r1 = (x: number) => Math.round(x * 10) / 10
  return { ...w, pdps: r1(pdps), edps: r1(edps), cdps: r1(cdps), dps: r1(pdps + edps + cdps) }
}

/** Заголовок расширенного формата (Ctrl+Alt+C): { Prefix Modifier "Cheetah's" (Tier: 1) — Speed } */
function parseHeader(h: string): Partial<ItemMod> & { kind?: ModKind } {
  const out: Partial<ItemMod> & { kind?: ModKind } = {}
  if (/Implicit Modifier/.test(h)) out.kind = 'implicit'
  if (/Master Crafted/.test(h)) out.kind = 'crafted'
  if (/Fractured/.test(h)) out.kind = 'fractured'
  if (/Prefix/.test(h)) out.gen = 'prefix'
  if (/Suffix/.test(h)) out.gen = 'suffix'
  const name = h.match(/"([^"]+)"/)
  if (name) out.affix = name[1]
  const tier = h.match(/\(Tier: (\d+)\)/)
  const rank = h.match(/\(Rank: (\d+)\)/)
  const eld = h.match(/Implicit Modifier \((Lesser|Greater|Grand|Exceptional|Exquisite|Perfect)\)/)
  if (rank) out.tier = 'R' + rank[1]
  else if (tier) out.tier = (out.gen === 'suffix' ? 'S' : 'P') + tier[1]
  else if (eld) out.tier = eld[1]
  return out
}

/** Текст, который игра кладёт в буфер по Ctrl+C или Ctrl+Alt+C (расширенный формат с тирами) на английском клиенте. */
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
  const itemLevel = ilvlLine ? num(ilvlLine) : null

  // ---- свойства: всё до секции с Item Level ----
  const props: ItemProps = {}
  const w: { phys?: [number, number]; ele: { type: DamageType; min: number; max: number }[]; chaos?: [number, number]; crit?: number; aps?: number } = { ele: [] }
  let isWeapon = false
  const def: NonNullable<ItemProps['defence']> = {}
  const req: NonNullable<ItemProps['req']> = {}
  for (const s of sections.slice(1, ilvlIdx >= 0 ? ilvlIdx + 1 : sections.length)) {
    for (const l of s) {
      let m: RegExpMatchArray | null
      if ((m = l.match(/^Quality[^:]*: \+?(\d+)%/))) props.quality = +m[1]
      else if ((m = l.match(/^Physical Damage: (.+)$/))) { w.phys = range(m[1]); isWeapon = true }
      else if ((m = l.match(/^Elemental Damage: (.+)$/))) {
        isWeapon = true
        for (const part of m[1].split(',')) { const r = range(part); if (r) w.ele.push({ type: 'ele', min: r[0], max: r[1] }) }
      } else if ((m = l.match(/^Chaos Damage: (.+)$/))) { w.chaos = range(m[1]); isWeapon = true }
      else if ((m = l.match(/^Critical Strike Chance: ([\d.]+)%/))) w.crit = +m[1]
      else if ((m = l.match(/^Attacks per Second: ([\d.]+)/))) w.aps = +m[1]
      else if ((m = l.match(/^Armour: (\d+)/))) def.ar = +m[1]
      else if ((m = l.match(/^Evasion Rating: (\d+)/))) def.ev = +m[1]
      else if ((m = l.match(/^Energy Shield: (\d+)/))) def.es = +m[1]
      else if ((m = l.match(/^Ward: (\d+)/))) def.ward = +m[1]
      else if ((m = l.match(/^Chance to Block: (\d+)%/))) def.block = +m[1]
      else if ((m = l.match(/^Level: (\d+)/))) req.level = +m[1]
      else if ((m = l.match(/^Str: (\d+)/))) req.str = +m[1]
      else if ((m = l.match(/^Dex: (\d+)/))) req.dex = +m[1]
      else if ((m = l.match(/^Int: (\d+)/))) req.int = +m[1]
      else if ((m = l.match(/^Requires (.+)$/))) {
        for (const part of m[1].split(',')) {
          const p = part.trim()
          let k: RegExpMatchArray | null
          if ((k = p.match(/^Level (\d+)/))) req.level = +k[1]
          else if ((k = p.match(/^(\d+) (Str|Dex|Int)/))) req[k[2].toLowerCase() as 'str' | 'dex' | 'int'] = +k[1]
        }
      } else if ((m = l.match(/^Sockets: (.+)$/))) {
        const groups = m[1].trim().split(/\s+/)
        const count = groups.reduce((a, g) => a + g.split('-').length, 0)
        const links = Math.max(...groups.map((g) => g.split('-').length))
        props.sockets = { count, links, text: m[1].trim() }
      }
    }
  }
  if (isWeapon) props.weapon = computeDps(w)
  if (Object.keys(def).length) props.defence = def
  if (Object.keys(req).length) props.req = req

  // ---- моды: всё после Item Level ----
  const mods: ItemMod[] = []
  let corrupted = false
  const flagLines = new Set(lines.filter((l) => FLAGS.test(l)))
  for (const s of sections.slice(ilvlIdx >= 0 ? ilvlIdx + 1 : 1)) {
    if (!s.length || (PROP_SECTION.test(s[0]) && !s[0].startsWith('{')) || USAGE.test(s[0])) continue
    let header: ReturnType<typeof parseHeader> | null = null
    for (const raw of s) {
      if (FLAGS.test(raw)) {
        if (raw === 'Corrupted') corrupted = true
        continue
      }
      if (raw.startsWith('{')) {
        header = parseHeader(raw)
        continue
      }
      if (raw.startsWith('(')) continue // пояснения расширенного формата
      const clean = raw.replace(/\((\d+(\.\d+)?)-(\d+(\.\d+)?)\)/g, '').replace(/\s+/g, ' ').trim()
      const tag = clean.match(TAG_RE)?.[1]
      const text = clean.replace(TAG_RE, '')
      const kind: ModKind =
        tag === 'implicit' ? 'implicit' : tag === 'enchant' ? 'enchant' : tag === 'crafted' ? 'crafted' : tag === 'fractured' ? 'fractured' : header?.kind ?? 'explicit'
      mods.push({ text, kind, tier: header?.tier, gen: header?.gen, affix: header?.affix })
    }
  }

  // в тексте игры стихийный урон не подписан — тип берём из мода "Adds 16 to 26 Cold Damage" с теми же числами
  for (const e of props.weapon?.ele ?? []) {
    for (const m of mods) {
      const x = m.text.match(/^Adds (\d+) to (\d+) (Fire|Cold|Lightning) Damage$/)
      if (x && +x[1] === e.min && +x[2] === e.max) e.type = x[3].toLowerCase() as DamageType
    }
  }

  // камни умений: уровень — первая строка «Level:» в блоке свойств (дальше идут требования)
  let gem: ParsedItem['gem']
  if (/Gems?$/.test(itemClass) || rarity === 'Gem') {
    const lvl = sections[1]?.find((l) => /^Level: \d+/.test(l))
    gem = { level: lvl ? num(lvl) : 1, quality: props.quality ?? 0, imbued: flagLines.has('Imbued'), vaal: /^Vaal /.test(name) }
    corrupted = flagLines.has('Corrupted')
    mods.length = 0 // описание камня — не моды
  }
  return {
    itemClass, rarity, name, baseType, itemLevel, slot: slotOfClass(itemClass, baseType), mods, props, corrupted,
    ...(flagLines.has('Unidentified') ? { unidentified: true } : {}), ...(gem ? { gem } : {})
  }
}

export const isImplicit = (m: ItemMod) => m.kind === 'implicit' || m.kind === 'enchant'

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
  for (const { text: l } of item.mods) {
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

/** Числа из текста мода: "Adds 10 to 20 Physical Damage" → [10, 20]. */
export const modNumbers = (text: string) => [...text.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
