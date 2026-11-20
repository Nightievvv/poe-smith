import type { AddableData, AddableGroup, ParsedItem } from '../../shared/types'
import { loadCraftData, matchMod, weightFor } from './craftdata'
import { basePool, resolveMod } from './modinfo'

/**
 * Докрафт: моды, которые можно добавить на предмет (обычные префиксы/суффиксы до ilvl предмета и моды верстака),
 * и группы модов, которые уже стоят на предмете, — чтобы интерфейс не дал выбрать мод той же группы
 * или четвёртый мод одной стороны.
 */
const clean = (t: string) => t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
const tpl = (line: string) => line.replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)|-?\d+(?:\.\d+)?/g, '#').toLowerCase()

export async function addableFor(item: ParsedItem): Promise<AddableData | null> {
  const d = await loadCraftData()
  const base = d.bases.get(item.baseType)?.[0]
  if (!base) return null
  const ilvl = item.itemLevel ?? 86
  const pool = basePool(d, base)
  const maxSide = /Jewel/.test(base.itemClass) ? 2 : 3

  // моды предмета: сторона и группы (для крафтовых — по моду верстака)
  const bench = d.bench.filter((b) => b.itemClasses.includes(base.itemClass))
  const existing = item.mods.map((m, idx) => {
    if (m.kind === 'crafted') {
      const b = bench.find((x) => { const bm = d.mods.get(x.modId); return bm && matchMod(bm, [m.text]) })
      const bm = b ? d.mods.get(b.modId) : undefined
      return { idx, gen: (bm?.gen === 'prefix' || bm?.gen === 'suffix' ? bm.gen : m.gen) as 'prefix' | 'suffix' | undefined, groups: bm?.groups ?? [], locked: false, crafted: true }
    }
    if (m.kind !== 'explicit' && m.kind !== 'fractured') return null
    const mod = resolveMod(pool, m.text, m.gen, ilvl)
    return { idx, gen: (mod?.gen ?? m.gen) as 'prefix' | 'suffix' | undefined, groups: mod?.groups ?? [], locked: m.kind === 'fractured', crafted: false }
  }).filter((x): x is NonNullable<typeof x> => !!x)
  // строки одного гибридного мода дают одну запись: склеиваем по одинаковым группам и стороне подряд
  const uniq: typeof existing = []
  for (const e of existing) {
    const prev = uniq[uniq.length - 1]
    if (prev && !e.crafted && !prev.crafted && e.groups.length && e.groups.join() === prev.groups.join() && e.gen === prev.gen && e.idx === prev.idx + 1) {
      ;(prev as { extra?: number[] }).extra = [...((prev as { extra?: number[] }).extra ?? []), e.idx]
      continue
    }
    uniq.push(e)
  }

  const groups = new Map<string, AddableGroup>()
  for (const m of pool) {
    if (m.reqLevel > ilvl) continue
    const key = `${m.gen}|${m.type}|${tpl(clean(m.text))}`
    const g = groups.get(key) ?? { id: key, gen: m.gen as 'prefix' | 'suffix', text: '', groups: m.groups, bench: false, tiers: [] }
    g.tiers.push({ id: m.id, text: clean(m.text), ilvl: m.reqLevel })
    groups.set(key, g)
  }
  for (const b of bench) {
    const m = d.mods.get(b.modId)
    if (!m || (m.gen !== 'prefix' && m.gen !== 'suffix') || /Crafted Modifiers|cannot be changed|Cannot roll/i.test(m.text)) continue
    if (m.weights.length && weightFor(m, base.tags) <= 0) continue
    const key = `bench|${m.gen}|${m.type}|${tpl(clean(m.text))}`
    const g = groups.get(key) ?? { id: key, gen: m.gen as 'prefix' | 'suffix', text: '', groups: m.groups, bench: true, tiers: [] }
    g.tiers.push({ id: m.id, text: clean(m.text), ilvl: m.reqLevel })
    groups.set(key, g)
  }
  const out = [...groups.values()]
  for (const g of out) {
    g.tiers.sort((a, b) => b.ilvl - a.ilvl)
    g.text = g.tiers[0].text.replace(/\n/g, ' / ')
  }
  out.sort((a, b) => Number(a.bench) - Number(b.bench) || (a.gen === b.gen ? a.text.localeCompare(b.text) : a.gen === 'prefix' ? -1 : 1))
  return {
    maxSide,
    existing: uniq.map((e) => ({ idx: e.idx, extra: (e as { extra?: number[] }).extra ?? [], gen: e.gen, groups: e.groups, locked: e.locked, crafted: e.crafted })),
    groups: out,
    blocked: item.corrupted ? 'corrupted' : null
  }
}
