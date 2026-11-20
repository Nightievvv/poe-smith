import type { ParsedItem, PcFilter, PcResult, PcRow, PriceCheckState } from '../../shared/types'
import { totals } from '../../shared/poe1/item'
import { SLOT_CATEGORY } from '../../shared/poe1/catalog'
import { STAT } from './profiles'
import { ensureStats, matchStat } from './stats'
import { search, fetchListings, tradeUrl } from './trade'
import { getRates } from './ninja'
import { loadCraftData } from './craftdata'
import { basePool, rankAtIlvl, resolveMod } from './modinfo'
import { listingToItem } from './listing'
import { gemType, uniqueCandidates } from './tradeitems'

const ROWS = 15
const down = (v: number) => Math.floor(v * 0.9)

function categoryFor(item: ParsedItem): string | null {
  if (item.slot === 'weapon2') {
    if (item.itemClass === 'Bows') return 'weapon.bow'
    if (/Staves/.test(item.itemClass)) return 'weapon.staff'
    return 'weapon.twomelee'
  }
  return item.slot ? SLOT_CATEGORY[item.slot] : null
}

/** Жизнь и сопротивления по умолчанию ищем суммой (псевдо-модами), а не отдельными строками. */
const COVERED_BY_PSEUDO = /^\+\d+ to maximum Life$|Resistances?$/
const RESIST = /Resistances?$/
/** «Дешёвые» моды — по умолчанию не отмечены (любой слот). */
const CHEAP = /Life Regenerat|Regenerate [\d.]+ Life|Mana Regenerat|Regenerate [\d.]+ Mana|Stun|Light Radius|Attribute Requirements|Reflects \d+ Physical Damage to Melee Attackers/i
/** Для брони дешёвыми считаем ещё атрибуты и редкость. */
const CHEAP_ARMOUR = /^\+\d+ to (Strength|Dexterity|Intelligence|all Attributes)( and (Strength|Dexterity|Intelligence))?$|Rarity of Items found/
/** Моды брони, которые меняют её защиту — защита и так ищется общими значениями. */
const ARMOUR_DEFENCE = /^\+\d+ to (Armour|Evasion Rating|maximum Energy Shield|Ward)$|^\d+% increased (Armour|Evasion Rating|Energy Shield|Ward)( and (Armour|Evasion|Evasion Rating|Energy Shield))?$|^\d+% increased Armour, Evasion and Energy Shield$/
/** Моды оружия, которые меняют DPS, скорость атаки или шанс крита — их покрывает фильтр DPS. Крит-множитель сюда не входит. */
const WEAPON_CORE = /^\d+% increased Physical Damage$|^Adds \d+ to \d+ (Physical|Fire|Cold|Lightning|Chaos) Damage$|^\d+% increased Attack Speed$|^\d+% increased Critical Strike Chance$/

/** Сопротивление в 4 лучших тирах, доступных на ilvl предмета. Без данных игры — по номеру тира из текста предмета. */
async function topTierRes(item: ParsedItem): Promise<(text: string, gen: string | undefined, tier: string | undefined) => boolean> {
  const ilvl = item.itemLevel ?? 86
  const d = await loadCraftData().catch(() => null)
  const base = d?.bases.get(item.baseType)?.[0]
  const pool = d && base ? basePool(d, base) : null
  return (text, gen, tier) => {
    if (pool) {
      const mod = resolveMod(pool, text, gen, ilvl)
      if (mod) return rankAtIlvl(pool, mod, ilvl) <= 4
    }
    const n = Number(tier?.match(/^[PS](\d+)$/)?.[1])
    return n > 0 && n <= 4
  }
}

/**
 * Фильтры по умолчанию. Тип базы не отмечен (ищем по категории слота).
 * Броня: общая защита (броня/уклонение/ЭЩ), сопротивления 4 лучших тиров на этом ilvl, остальное — кроме модов на защиту и дешёвых.
 * Оружие: общий DPS и моды, не влияющие на DPS/скорость атаки/шанс крита.
 * Остальные слоты: как раньше, но без дешёвых модов. Порог каждого значения — 90% от предмета.
 */
export async function defaultFilters(item: ParsedItem, league?: string): Promise<PriceCheckState> {
  // камни: только уровень, качество и статусы (моды и описание не нужны)
  if (item.gem) {
    const g = item.gem
    const tf = await gemType(item.name).catch(() => ({ transfigured: false }))
    const f: PcFilter[] = [
      { key: 'base', label: item.name, kind: 'base', value: null, min: null, max: null, enabled: true, matched: true },
      { key: 'gem_level', label: 'Gem Level', kind: 'gem', statId: 'gem_level', value: g.level, min: g.level, max: null, enabled: true, matched: true },
      { key: 'quality', label: 'Quality', kind: 'quality', statId: 'quality', value: g.quality, min: g.quality || null, max: null, enabled: g.quality > 0, matched: true },
      // статусы камня: галочка — свойство есть, без галочки — свойства нет (ищем именно такие камни)
      { key: 'corrupted', label: 'Corrupted', kind: 'flag', statId: 'corrupted', value: null, min: null, max: null, enabled: item.corrupted, matched: true },
      { key: 'gem_transfigured', label: 'Transfigured', kind: 'flag', statId: 'gem_transfigured', value: null, min: null, max: null, enabled: tf.transfigured, matched: true },
      { key: 'gem_imbued', label: 'Imbued', kind: 'flag', statId: 'gem_imbued', value: null, min: null, max: null, enabled: g.imbued, matched: true }
    ]
    return { item, filters: f }
  }
  await ensureStats().catch(() => undefined)
  const f: PcFilter[] = []
  const unique = item.rarity === 'Unique'
  const w = item.props.weapon
  const d = item.props.defence
  const isWeapon = !!w
  const isArmour = !isWeapon && !!d && (!!d.ar || !!d.ev || !!d.es || !!d.ward)
  // база: у уникальных и флаконов (Silver, Bismuth… — разные предметы) включена сразу
  f.push({ key: 'base', label: item.baseType, kind: 'base', value: null, min: null, max: null, enabled: unique || item.slot === 'flask', matched: true })
  if (item.props.quality) f.push({ key: 'quality', label: 'Quality', kind: 'quality', statId: 'quality', value: item.props.quality, min: item.props.quality, max: null, enabled: false, matched: true })
  if (item.itemLevel) f.push({ key: 'ilvl', label: 'Item Level', kind: 'ilvl', value: item.itemLevel, min: item.itemLevel, max: null, enabled: false, matched: true })

  const t = totals(item)
  const pseudo = (key: string, id: string, label: string, v: number, on: boolean) => {
    if (v > 0) f.push({ key, label, kind: 'pseudo', statId: id, value: v, min: down(v), max: null, enabled: !unique && on, matched: true })
  }
  pseudo('p-life', STAT.life, '+# total maximum Life', t.life, true)
  // у брони сопротивления ищутся отдельными строками высоких тиров
  pseudo('p-ele', STAT.eleRes, '+#% total Elemental Resistance', t.eleRes, !isArmour)
  pseudo('p-chaos', STAT.chaosRes, '+#% total Chaos Resistance', t.chaosRes, !isArmour)

  if (w?.dps) f.push({ key: 'dps', label: 'DPS', kind: 'weapon', statId: 'dps', value: w.dps, min: down(w.dps), max: null, enabled: !unique, matched: true })
  if (w?.pdps) f.push({ key: 'pdps', label: 'Physical DPS', kind: 'weapon', statId: 'pdps', value: w.pdps, min: down(w.pdps), max: null, enabled: false, matched: true })
  if (w?.edps) f.push({ key: 'edps', label: 'Elemental DPS', kind: 'weapon', statId: 'edps', value: w.edps, min: down(w.edps), max: null, enabled: false, matched: true })
  for (const [k, label] of [['ar', 'Armour'], ['ev', 'Evasion'], ['es', 'Energy Shield']] as const) {
    const v = d?.[k]
    if (v) f.push({ key: k, label, kind: 'defence', statId: k, value: v, min: down(v), max: null, enabled: isArmour && !unique, matched: true })
  }

  const so = item.props.sockets
  if (so) {
    const none = { r: null, g: null, b: null, w: null }
    f.push({ key: 'links', label: 'Links', kind: 'links', value: so.links, min: so.links, max: null, enabled: so.links >= 5, matched: true, colors: { ...none } })
    f.push({ key: 'sockets', label: 'Sockets', kind: 'sockets', value: so.count, min: so.count, max: null, enabled: false, matched: true, colors: { ...none } })
  }

  const topRes = isArmour ? await topTierRes(item) : null
  const preferLocal = !!(item.props.weapon || item.props.defence)
  item.mods.forEach((m, i) => {
    const hit = matchStat(m.text, m.kind, preferLocal)
    const v = hit?.value ?? null
    const explicitLike = m.kind === 'explicit' || m.kind === 'fractured'
    let on = !!hit && !unique && explicitLike && !CHEAP.test(m.text)
    if (on && isArmour) {
      if (ARMOUR_DEFENCE.test(m.text) || CHEAP_ARMOUR.test(m.text)) on = false
      else if (RESIST.test(m.text)) on = topRes!(m.text, m.gen, m.tier)
      else if (COVERED_BY_PSEUDO.test(m.text)) on = false
    } else if (on && isWeapon) {
      if (WEAPON_CORE.test(m.text) || COVERED_BY_PSEUDO.test(m.text)) on = false
    } else if (on && COVERED_BY_PSEUDO.test(m.text)) on = false
    f.push({
      key: `mod-${i}`, label: m.text, kind: m.kind, statId: hit?.id, tier: m.tier, gen: m.gen, value: v,
      min: v != null && v > 0 ? down(v) : v, max: null, enabled: on, matched: !!hit
    })
  })
  // неопознанный уникальный: имени нет — сначала выбор предмета из уникальных этой базы
  if (unique && item.unidentified && item.name === item.baseType) {
    const uniques = league ? await uniqueCandidates(league, item.baseType).catch(() => []) : []
    return { item, filters: f, uniques }
  }
  return { item, filters: f }
}

export async function pcSearch(league: string, item: ParsedItem, filters: PcFilter[]): Promise<PcResult> {
  const on = filters.filter((x) => x.enabled && x.matched)
  const base = on.find((x) => x.kind === 'base')
  const rarity = item.gem ? null : item.rarity === 'Magic' ? 'magic' : item.rarity === 'Normal' ? 'normal' : item.rarity === 'Unique' ? 'unique' : 'rare'
  const typeFilters: Record<string, unknown> = rarity ? { rarity: { option: rarity } } : {}
  const cat = categoryFor(item)
  if (!base && cat && !item.gem) typeFilters.category = { option: cat }

  const val = (x: PcFilter) => ({ ...(x.min != null ? { min: x.min } : {}), ...(x.max != null ? { max: x.max } : {}) })
  const weapon: Record<string, unknown> = {}
  const armour: Record<string, unknown> = {}
  const misc: Record<string, unknown> = {}
  const socket: Record<string, unknown> = {}
  const stats: { id: string; value: Record<string, number> }[] = []
  for (const x of on) {
    if (x.kind === 'sockets' || x.kind === 'links') {
      // трейд считает цвета по количеству (R/G/B/W), конкретный порядок гнёзд не задаётся
      const c = Object.fromEntries(Object.entries(x.colors ?? {}).filter(([, v]) => v != null && v > 0))
      socket[x.kind] = { ...val(x), ...c }
    } else if (x.kind === 'weapon') weapon[x.statId!] = val(x)
    else if (x.kind === 'defence') armour[x.statId!] = val(x)
    else if (x.kind === 'ilvl') misc.ilvl = val(x)
    else if (x.kind === 'quality' || x.kind === 'gem') misc[x.statId!] = val(x)

    else if (x.statId && x.kind !== 'base' && x.kind !== 'flag') stats.push({ id: x.statId, value: val(x) })
  }
  // статусы камня учитываются всегда: снятая галочка — «нет»
  for (const x of filters) if (x.kind === 'flag') misc[x.statId!] = { option: x.enabled ? 'true' : 'false' }
  const fl: Record<string, unknown> = {
    type_filters: { filters: typeFilters },
    trade_filters: { filters: { sale_type: { option: 'priced' } } }
  }
  if (Object.keys(weapon).length) fl.weapon_filters = { filters: weapon }
  if (Object.keys(armour).length) fl.armour_filters = { filters: armour }
  if (Object.keys(misc).length) fl.misc_filters = { filters: misc }
  if (Object.keys(socket).length) fl.socket_filters = { filters: socket }
  const query: Record<string, unknown> = { status: { option: 'available' }, stats: [{ type: 'and', filters: stats }], filters: fl }
  if (item.gem) {
    // transfigured-камень трейд ищет как базовый камень + discriminator
    if (base) {
      const g = await gemType(item.name)
      query.type = g.discriminator ? { option: g.option, discriminator: g.discriminator } : g.option
    }
  } else {
    if (base) query.type = item.baseType
    if (rarity === 'unique') {
      query.name = item.name
      query.type = item.baseType
    }
  }

  const s = await search(league, { query, sort: { price: 'asc' } })
  const page = await pcPage(league, item, s.id, s.result.slice(0, ROWS))
  return { total: s.total, rows: page.rows, tradeUrl: tradeUrl(league, s.id), divine: page.divine, queryId: s.id, rest: s.result.slice(ROWS) }
}

/** Следующие лоты того же поиска (кнопка «Загрузить ещё»): выгрузка тратит только лимит fetch, новый поиск не делается. */
export async function pcMore(league: string, item: ParsedItem, queryId: string, ids: string[]): Promise<{ rows: PcRow[]; rest: string[] }> {
  const page = await pcPage(league, item, queryId, ids.slice(0, ROWS))
  return { rows: page.rows, rest: ids.slice(ROWS) }
}

async function pcPage(league: string, item: ParsedItem, queryId: string, ids: string[]): Promise<{ rows: PcRow[]; divine: number }> {
  const rates = await getRates(league)
  const listings = ids.length ? await fetchListings(ids, queryId) : []
  const rows = listings
    .filter((l) => l.listing.price && rates.chaosPer[l.listing.price.currency])
    .map((l) => {
      const p = l.listing.price!
      return {
        name: (l.item.name || l.item.typeLine).replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2'),
        ilvl: l.item.ilvl ?? null,
        quality: listingToItem(l, item.slot).props.quality,
        gemLevel: item.gem ? Number(String(((l.item as { properties?: { name: string; values: [string, number][] }[] }).properties ?? []).find((x) => x.name === 'Level')?.values?.[0]?.[0] ?? '').replace(/[^\d]/g, '')) || undefined : undefined,
        rarity: l.item.rarity ?? (item.gem ? 'Gem' : 'Rare'),
        amount: p.amount,
        currency: p.currency,
        price: `${p.amount} ${p.currency}`,
        priceDiv: (p.amount * rates.chaosPer[p.currency]) / rates.divine,
        item: listingToItem(l, item.slot)
      }
    })
    .sort((a, b) => a.priceDiv - b.priceDiv)
  return { rows, divine: rates.divine }
}
