import { atLeast } from './mapregex'
import type { ItemModData, ItemModGroup } from './types'

/**
 * Regex предметов (как раздел Items на poe.re): для каждого выбранного мода — «число не меньше минимума тира»
 * плюс самый короткий кусок текста сразу после числа (или перед ним), который отличает этот мод от других модов базы.
 * «+(80-89) to maximum Life» с тиром ≥T2 → «(8.|9.|\d..) to ma».
 */
export interface ItemRegexPick {
  id: string
  /** индекс тира в group.tiers: 0 — T1; выбранный тир и все лучше */
  tier: number
}

export interface ItemRegexResult {
  regex: string
  failed: string[]
}

const esc = (s: string) => s.replace(/[+().?*[\]\\|^$]/g, (c) => '\\' + c)

function termFor(g: ItemModGroup, tier: number, others: string[]): string | null {
  const line = g.match[0]
  const t = g.tiers[Math.min(tier, g.tiers.length - 1)]
  const lowest = tier >= g.tiers.length - 1
  const i = line.indexOf('#')
  const num = t.min != null && !lowest && t.min > 0 ? atLeast(Math.floor(t.min)) : null
  if (i >= 0) {
    // текст сразу после числа
    const post = line.slice(i + 1).split('#')[0]
    for (let k = 2; k <= post.length; k++) {
      const f = post.slice(0, k)
      if (others.some((o) => o.includes('#' + f))) continue
      return num ? num + esc(f) : esc(f)
    }
    // текст перед числом
    const pre = line.slice(0, i)
    for (let k = 2; k <= pre.length; k++) {
      const f = pre.slice(pre.length - k)
      if (others.some((o) => o.includes(f + '#'))) continue
      return num ? esc(f) + num : esc(f)
    }
  }
  // без чисел — самый короткий уникальный кусок строки
  for (let len = 2; len <= line.length; len++)
    for (let a = 0; a + len <= line.length; a++) {
      const f = line.slice(a, a + len)
      if (f.includes('#')) continue
      if (others.some((o) => o.includes(f))) continue
      return esc(f)
    }
  return null
}

export function buildItemRegex(data: ItemModData, picks: ItemRegexPick[], mode: 'any' | 'all'): ItemRegexResult {
  const failed: string[] = []
  const terms: string[] = []
  for (const p of picks) {
    const g = data.groups.find((x) => x.id === p.id)
    if (!g) continue
    // та же строка в гибридном моде (например, жизнь + броня) неизбежно совпадёт — это допустимо
    const others = data.groups.filter((x) => x !== g).flatMap((x) => x.match).filter((l) => !g.match.includes(l))
    const term = termFor(g, p.tier, others)
    if (term) terms.push(term)
    else failed.push(g.text)
  }
  if (!terms.length) return { regex: '', failed }
  const regex = mode === 'any' ? `"${terms.join('|')}"` : terms.map((t) => `"${t}"`).join(' ')
  return { regex, failed }
}
