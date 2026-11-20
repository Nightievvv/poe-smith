import type { ParsedItem } from '../../shared/types'
import { craftDataIfLoaded, matchMod, weightFor, type Base, type CraftData, type Mod } from './craftdata'

/** Мод подходит базе по домену (обычные предметы, самоцветы, абиссальные самоцветы). */
export function domainOk(mod: Mod, base: Base) {
  if (mod.domain === base.domain) return true
  if (base.itemClass === 'Jewel') return mod.domain === 'jewel'
  if (/Abyss/.test(base.itemClass)) return mod.domain === 'abyss_jewel'
  return false
}

/** Пул префиксов/суффиксов базы (без ограничения по ilvl). */
export function basePool(d: CraftData, base: Base): Mod[] {
  return [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, base.tags) > 0)
}

/** Мод игры для строки предмета: самый высокий тир, который подходит по числам и доступен на этом ilvl. */
export function resolveMod(pool: Mod[], text: string, gen: string | undefined, ilvl: number): Mod | undefined {
  const cands = pool.filter((x) => (!gen || x.gen === gen) && matchMod(x, [text])).sort((a, b) => b.reqLevel - a.reqLevel)
  return cands.find((x) => x.reqLevel <= ilvl) ?? cands[0]
}

/** Место мода среди тиров, доступных на этом ilvl: 1 — лучший доступный. */
export function rankAtIlvl(pool: Mod[], mod: Mod, ilvl: number): number {
  return pool.filter((x) => x.type === mod.type && x.gen === mod.gen && x.reqLevel <= ilvl && x.reqLevel > mod.reqLevel).length + 1
}

/**
 * Сторона (префикс/суффикс) для модов верстака с трейда: трейд пишет им тир «R…» без стороны.
 * Работает, только если данные игры уже загружены; иначе предмет не меняется.
 */
export function fillCraftedGen<T extends ParsedItem>(item: T): T {
  const d = craftDataIfLoaded()
  if (!d || !item.mods.some((m) => m.kind === 'crafted' && !m.gen)) return item
  const crafted = [...d.mods.values()].filter((m) => m.domain === 'crafted' && (m.gen === 'prefix' || m.gen === 'suffix'))
  return {
    ...item,
    mods: item.mods.map((m) => {
      if (m.kind !== 'crafted' || m.gen) return m
      const hit = crafted.find((x) => matchMod(x, [m.text]))
      return hit ? { ...m, gen: hit.gen as 'prefix' | 'suffix' } : m
    })
  }
}
