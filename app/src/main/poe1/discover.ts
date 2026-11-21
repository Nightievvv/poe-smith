import type { DiscoveredCombo, SlotId } from '../../shared/types'
import { SLOT_CATEGORY } from '../../shared/poe1/catalog'
import { ensureStats, matchStat } from './stats'
import { search, fetchListings } from './trade'
import { getRates } from './ninja'
import { STAT, type Profile } from './profiles'
import { addCustomProfile } from './customprofiles'
import { quantile } from '../../shared/analyze'

/**
 * Автопоиск выгодных сочетаний модов: 40 свежих дорогих редких предметов слота (цена от minDiv),
 * у каждого — набор модов (жизнь и сопротивления суммами, как псевдо-моды трейда), затем частые пары и тройки.
 * Сочетание, которое встречается хотя бы у 4 лотов, — кандидат в профиль: порог мода — нижняя четверть значений.
 */
const SAMPLE = 40
/** дешёвые моды, которые не делают цену предмета (как в прайс-чеке) */
const CHEAP = /Life Regenerat|Regenerate [\d.]+ Life|Mana Regenerat|Regenerate [\d.]+ Mana|Stun|Light Radius|Attribute Requirements|Reflects \d+ Physical Damage to Melee Attackers|Rarity of Items found|Accuracy Rating$/i
const RES = /^\+(\d+)% to (Fire|Cold|Lightning)( and (Fire|Cold|Lightning))? Resistances?$|^\+(\d+)% to all Elemental Resistances$/

export async function discoverCombos(league: string, slot: SlotId, minDiv: number): Promise<DiscoveredCombo[]> {
  await ensureStats().catch(() => undefined)
  const rates = await getRates(league)
  const query = {
    status: { option: 'available' },
    stats: [{ type: 'and', filters: [] }],
    filters: {
      type_filters: { filters: { category: { option: SLOT_CATEGORY[slot] }, rarity: { option: 'rare' } } },
      misc_filters: { filters: { corrupted: { option: 'false' } } },
      trade_filters: { filters: { sale_type: { option: 'priced' }, indexed: { option: '3days' }, price: { min: minDiv, option: 'divine' } } }
    }
  }
  const s = await search(league, { query, sort: { indexed: 'desc' } })
  const listings = s.result.length ? await fetchListings(s.result.slice(0, SAMPLE), s.id) : []
  const preferLocal = slot !== 'ring' && slot !== 'amulet' && slot !== 'belt' && slot !== 'jewel'

  type Entry = { keys: Map<string, number>; price: number }
  const labels = new Map<string, string>()
  const items: Entry[] = []
  for (const l of listings) {
    const pr = l.listing.price
    const per = pr ? rates.chaosPer[pr.currency] : undefined
    if (!pr || !per) continue
    const keys = new Map<string, number>()
    let life = 0
    let res = 0
    for (const raw of l.item.explicitMods ?? []) {
      const text = typeof raw === 'string' ? raw : raw.description
      let m: RegExpMatchArray | null
      if (CHEAP.test(text)) continue
      if ((m = text.match(/^\+(\d+) to maximum Life$/))) life += +m[1]
      else if ((m = text.match(RES))) res += m[5] ? 3 * +m[5] : m[3] ? 2 * +m[1] : +m[1]
      else {
        const h = matchStat(text, 'explicit', preferLocal)
        if (!h || h.value == null) continue
        keys.set(h.id, Math.max(keys.get(h.id) ?? 0, h.value))
        if (!labels.has(h.id)) labels.set(h.id, text.replace(/\d+(\.\d+)?/g, '#'))
      }
    }
    if (life) keys.set(STAT.life, life)
    if (res) keys.set(STAT.eleRes, res)
    labels.set(STAT.life, '+# total maximum Life')
    labels.set(STAT.eleRes, '+#% total Elemental Resistance')
    items.push({ keys, price: (pr.amount * per) / rates.divine })
  }

  // частые пары и тройки
  const combos = new Map<string, { ids: string[]; hits: Entry[] }>()
  for (const it of items) {
    const ids = [...it.keys.keys()].sort()
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const pair = [ids[a], ids[b]]
        const k2 = pair.join('|')
        if (!combos.has(k2)) combos.set(k2, { ids: pair, hits: [] })
        combos.get(k2)!.hits.push(it)
        for (let c = b + 1; c < ids.length; c++) {
          const tri = [ids[a], ids[b], ids[c]]
          const k3 = tri.join('|')
          if (!combos.has(k3)) combos.set(k3, { ids: tri, hits: [] })
          combos.get(k3)!.hits.push(it)
        }
      }
  }
  const out: DiscoveredCombo[] = []
  for (const c of combos.values()) {
    if (c.hits.length < 4) continue
    const prices = c.hits.map((h) => h.price).sort((x, y) => x - y)
    out.push({
      slot,
      count: c.hits.length,
      sample: items.length,
      medianDiv: quantile(prices, 0.5),
      stats: c.ids.map((id) => {
        const vals = c.hits.map((h) => h.keys.get(id)!).sort((x, y) => x - y)
        return { id, label: labels.get(id) ?? id, min: Math.floor(quantile(vals, 0.25)) }
      })
    })
  }
  // больше модов и чаще — выше; одинаковые по смыслу (пара внутри тройки с той же частотой) убираем
  out.sort((a, b) => b.count * b.medianDiv * b.stats.length - a.count * a.medianDiv * a.stats.length)
  const kept: DiscoveredCombo[] = []
  for (const c of out) {
    const ids = c.stats.map((x) => x.id)
    if (kept.some((k) => k.count === c.count && ids.every((id) => k.stats.some((x) => x.id === id)))) continue
    kept.push(c)
    if (kept.length >= 8) break
  }
  return kept
}

/** Сочетание → свой профиль рынка (его подхватят «Возможности» и вкладка «Рынок»). */
export function saveCombo(c: DiscoveredCombo, name: string): Profile {
  const p: Profile = {
    id: 'custom-auto-' + Date.now(),
    slot: c.slot,
    name: { ru: name, en: name },
    custom: true,
    rarity: 'rare',
    stats: c.stats.map((x) => ({ id: x.id, min: x.min }))
  }
  // тексты для планировщика: псевдо-суммы раскладываются профилем сами, остальные — шаблон с порогом
  const texts = c.stats.filter((x) => x.id !== STAT.life && x.id !== STAT.eleRes).map((x) => x.label.replace('#', String(x.min)))
  if (texts.length === c.stats.length) p.targetMods = texts
  addCustomProfile(p)
  return p
}
