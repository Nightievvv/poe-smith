import type { ParsedItem, PcFilter, PcResult, PriceCheckState } from '../../shared/types'
import { totals } from '../../shared/poe1/item'
import { SLOT_CATEGORY } from '../../shared/poe1/catalog'
import { STAT } from './profiles'
import { ensureStats, matchStat } from './stats'
import { search, fetchListings, tradeUrl } from './trade'
import { getRates } from './ninja'

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

/** Фильтры по умолчанию: база, суммы жизни/сопротивлений, DPS/защита и каждый мод с порогом 90% от значения. */
export async function defaultFilters(item: ParsedItem): Promise<PriceCheckState> {
  await ensureStats().catch(() => undefined)
  const f: PcFilter[] = []
  const unique = item.rarity === 'Unique'
  f.push({ key: 'base', label: item.baseType, kind: 'base', value: null, min: null, max: null, enabled: true, matched: true })
  if (item.itemLevel) f.push({ key: 'ilvl', label: 'Item Level', kind: 'ilvl', value: item.itemLevel, min: item.itemLevel, max: null, enabled: false, matched: true })

  const t = totals(item)
  const pseudo = (key: string, id: string, label: string, v: number) => {
    if (v > 0) f.push({ key, label, kind: 'pseudo', statId: id, value: v, min: down(v), max: null, enabled: !unique, matched: true })
  }
  pseudo('p-life', STAT.life, '+# total maximum Life', t.life)
  pseudo('p-ele', STAT.eleRes, '+#% total Elemental Resistance', t.eleRes)
  pseudo('p-chaos', STAT.chaosRes, '+#% total Chaos Resistance', t.chaosRes)

  const w = item.props.weapon
  if (w?.pdps) f.push({ key: 'pdps', label: 'Physical DPS', kind: 'weapon', statId: 'pdps', value: w.pdps, min: down(w.pdps), max: null, enabled: w.pdps >= w.edps, matched: true })
  if (w?.edps) f.push({ key: 'edps', label: 'Elemental DPS', kind: 'weapon', statId: 'edps', value: w.edps, min: down(w.edps), max: null, enabled: w.edps > w.pdps, matched: true })
  const d = item.props.defence
  for (const [k, label] of [['ar', 'Armour'], ['ev', 'Evasion'], ['es', 'Energy Shield']] as const) {
    const v = d?.[k]
    if (v) f.push({ key: k, label, kind: 'defence', statId: k, value: v, min: down(v), max: null, enabled: false, matched: true })
  }

  const preferLocal = !!(item.props.weapon || item.props.defence)
  item.mods.forEach((m, i) => {
    const hit = matchStat(m.text, m.kind, preferLocal)
    const v = hit?.value ?? null
    const explicitLike = m.kind === 'explicit' || m.kind === 'fractured'
    f.push({
      key: `mod-${i}`, label: m.text, kind: m.kind, statId: hit?.id, tier: m.tier, value: v,
      min: v != null && v > 0 ? down(v) : v, max: null,
      enabled: !!hit && !unique && explicitLike && !COVERED_BY_PSEUDO.test(m.text),
      matched: !!hit
    })
  })
  return { item, filters: f }
}

export async function pcSearch(league: string, item: ParsedItem, filters: PcFilter[]): Promise<PcResult> {
  const on = filters.filter((x) => x.enabled && x.matched)
  const base = on.find((x) => x.kind === 'base')
  const rarity = item.rarity === 'Magic' ? 'magic' : item.rarity === 'Normal' ? 'normal' : item.rarity === 'Unique' ? 'unique' : 'rare'
  const typeFilters: Record<string, unknown> = { rarity: { option: rarity } }
  const cat = categoryFor(item)
  if (!base && cat) typeFilters.category = { option: cat }

  const val = (x: PcFilter) => ({ ...(x.min != null ? { min: x.min } : {}), ...(x.max != null ? { max: x.max } : {}) })
  const weapon: Record<string, unknown> = {}
  const armour: Record<string, unknown> = {}
  const misc: Record<string, unknown> = {}
  const stats: { id: string; value: Record<string, number> }[] = []
  for (const x of on) {
    if (x.kind === 'weapon') weapon[x.statId!] = val(x)
    else if (x.kind === 'defence') armour[x.statId!] = val(x)
    else if (x.kind === 'ilvl') misc.ilvl = val(x)
    else if (x.statId && x.kind !== 'base') stats.push({ id: x.statId, value: val(x) })
  }
  const fl: Record<string, unknown> = {
    type_filters: { filters: typeFilters },
    trade_filters: { filters: { sale_type: { option: 'priced' } } }
  }
  if (Object.keys(weapon).length) fl.weapon_filters = { filters: weapon }
  if (Object.keys(armour).length) fl.armour_filters = { filters: armour }
  if (Object.keys(misc).length) fl.misc_filters = { filters: misc }
  const query: Record<string, unknown> = { status: { option: 'available' }, stats: [{ type: 'and', filters: stats }], filters: fl }
  if (base) query.type = item.baseType
  if (rarity === 'unique') query.name = item.name

  const rates = await getRates(league)
  const s = await search(league, { query, sort: { price: 'asc' } })
  const listings = s.result.length ? await fetchListings(s.result.slice(0, 20), s.id) : []
  const rows = listings
    .filter((l) => l.listing.price && rates.chaosPer[l.listing.price.currency])
    .map((l) => {
      const p = l.listing.price!
      return {
        name: (l.item.name || l.item.typeLine).replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2'),
        ilvl: l.item.ilvl ?? null,
        price: `${p.amount} ${p.currency}`,
        priceDiv: (p.amount * rates.chaosPer[p.currency]) / rates.divine
      }
    })
    .sort((a, b) => a.priceDiv - b.priceDiv)
    .slice(0, ROWS)
  return { total: s.total, rows, tradeUrl: tradeUrl(league, s.id), divine: rates.divine }
}
