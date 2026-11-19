import type { ParsedItem, PriceCheck, Settings } from '../../shared/types'
import { totals } from '../../shared/poe1/item'
import { STAT } from './profiles'
import type { QuerySpec } from './query'
import { runQuery } from './market'

const CATEGORY: Record<string, string> = {
  helmet: 'armour.helmet', body: 'armour.chest', gloves: 'armour.gloves', boots: 'armour.boots', shield: 'armour.shield',
  quiver: 'armour.quiver', amulet: 'accessory.amulet', ring: 'accessory.ring', belt: 'accessory.belt',
  weapon1: 'weapon.one', jewel: 'jewel.base', abyss: 'jewel.abyss', cluster: 'jewel.cluster', flask: 'flask'
}

function categoryFor(item: ParsedItem): string | null {
  if (item.slot === 'weapon2') {
    if (item.itemClass === 'Bows') return 'weapon.bow'
    if (/Staves/.test(item.itemClass)) return 'weapon.staff'
    return 'weapon.twomelee'
  }
  return item.slot ? CATEGORY[item.slot] : null
}

/** Ищет на трейде похожие предметы: та же база и не меньше ~85% ключевых сумм (жизнь, сопротивления…). */
export function specFor(item: ParsedItem): { spec: QuerySpec; criteria: string[] } | null {
  const category = categoryFor(item)
  if (!category) return null
  const rarity = item.rarity === 'Magic' ? 'magic' : item.rarity === 'Normal' ? 'normal' : 'rare'
  const t = totals(item)
  const stats: QuerySpec['stats'] = []
  const criteria = [item.baseType]
  const add = (id: string, v: number, label: string, k = 0.85) => {
    if (v <= 0) return
    const min = Math.floor(v * k)
    stats.push({ id, min })
    criteria.push(`${label} ${min}+`)
  }
  add(STAT.life, t.life, 'Life')
  add(STAT.eleRes, t.eleRes, 'Ele res')
  add(STAT.chaosRes, t.chaosRes, 'Chaos res')
  add(STAT.moveSpeed, t.moveSpeed, 'Move speed', 1)
  add(STAT.suppress, t.suppress, 'Suppress')
  return { spec: { category, rarity, type: item.baseType, stats }, criteria }
}

export async function priceCheck(league: string, item: ParsedItem, settings: Settings): Promise<PriceCheck> {
  const s = specFor(item)
  if (!s) return { item, criteria: [], result: null, loading: false, error: 'unsupported' }
  try {
    const q = await runQuery(league, s.spec, settings)
    return {
      item,
      criteria: s.criteria,
      loading: false,
      result: { id: 'pricecheck', name: { ru: item.name, en: item.name }, base: item.baseType, ...q, trend: null }
    }
  } catch (e) {
    return { item, criteria: s.criteria, result: null, loading: false, error: e instanceof Error ? e.message : String(e) }
  }
}
