import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { MapModData, MapModInfo } from '../../shared/types'
import { loadCraftData } from './craftdata'

/**
 * Моды карт для генератора regex (как poe.re): берём префиксы/суффиксы домена area, которые могут выпасть на обычных
 * картах (теги default / low/mid/top/uber_tier_map). Тиры одного мода склеиваем в одну строку с общим диапазоном.
 * Строки с бонусами к добыче («Atlas Drops», «Pack size», «more Maps found») на карте показываются сводными свойствами —
 * в тексте мода их не ищем.
 */
const MAP_TAGS = new Set(['default', 'low_tier_map', 'mid_tier_map', 'top_tier_map', 'uber_tier_map'])
const BONUS = /Atlas Drops|Rarity of Items found in this Area|increased Pack size|found in Area/i
/** Строки, которые бывают на любой карте: свойства, редкость, служебный текст. Нужны, чтобы фрагмент мода не совпал с ними. */
const COMMON = [
  'Item Class: Maps', 'Rarity: Normal', 'Rarity: Magic', 'Rarity: Rare', 'Rarity: Unique', 'Map Tier: #', 'Atlas Drops: +#%', 'Item Rarity: +#%',
  'Monster Pack Size: +#%', 'More Maps: +#%', 'More Currency: +#%', 'More Threads: +#%', 'More Divination Cards: +#%', 'Quality: +#%',
  'Quality (Pack Size): +#%', 'Quality (Rarity): +#%', 'Quality (Currency): +#%', 'Quality (Divination Cards): +#%', 'Quality (Threads): +#%',
  'Item Level: #', 'Corrupted', 'Unidentified', 'Travel to this Map by using it in a personal Map Device. Maps can only be used once.',
  'Can be used in a personal Map Device.', 'Delirium Reward Type', 'Area is influenced by The Elder', 'Area is influenced by The Shaper',
  'Area is influenced by the Originator\'s Memories', 'Map Device', 'Note: ~price'
]

const clean = (t: string) => t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
/** «(20-29)% more Monster Life» → «#% more Monster Life» */
const template = (t: string) => t.replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)|-?\d+(?:\.\d+)?/g, '#')
const numbers = (t: string): [number, number][] =>
  [...t.matchAll(/\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)|(-?\d+(?:\.\d+)?)/g)].map((m) => (m[3] != null ? [Number(m[3]), Number(m[3])] : [Number(m[1]), Number(m[2])]))

let cache: MapModData | null = null

export async function mapMods(): Promise<MapModData> {
  if (cache) return cache
  await loadCraftData() // гарантирует, что файлы RePoE скачаны
  const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'repoe', 'mods.min.json'), 'utf-8')) as Record<string, any>
  const groups = new Map<string, { gen: 'prefix' | 'suffix'; t17: boolean; tiers: string[] }>()
  const corpus = new Set<string>(COMMON.map((s) => s.toLowerCase()))
  // названия карт тоже есть в тексте предмета: «!ate» не должен отсечь, например, «Gate Map»
  try {
    const bases = JSON.parse(readFileSync(join(app.getPath('userData'), 'repoe', 'base_items.min.json'), 'utf-8')) as Record<string, any>
    for (const b of Object.values(bases)) if (b.item_class === 'Map' && b.name) corpus.add(String(b.name).toLowerCase())
  } catch {
    /* без названий карт */
  }
  for (const [, m] of Object.entries(raw)) {
    if (m.domain !== 'area' || !m.text) continue
    const lines = clean(String(m.text)).split('\n').filter((l) => !BONUS.test(l))
    if (!lines.length) continue
    const onMaps = ['prefix', 'suffix'].includes(m.generation_type) && (m.spawn_weights ?? []).some((w: { tag: string; weight: number }) => w.weight > 0 && MAP_TAGS.has(w.tag))
    if (!onMaps) {
      // имплиситы осквернённых карт тоже бывают на обычных картах — фрагменты не должны с ними совпадать
      // (моды уникальных карт, логбуков и т.п. не учитываем: на обычных картах их нет)
      if (m.generation_type === 'corrupted') for (const l of lines) corpus.add(template(l).toLowerCase())
      continue
    }
    const t17 = (m.spawn_weights ?? []).some((w: { tag: string; weight: number }) => w.weight > 0 && w.tag === 'uber_tier_map')
    const text = lines.join('\n')
    const key = (t17 ? 'U:' : '') + template(text)
    const g = groups.get(key) ?? { gen: m.generation_type as "prefix" | "suffix", t17, tiers: [] as string[] }
    g.tiers.push(text)
    groups.set(key, g)
  }
  const mods: MapModInfo[] = []
  for (const [key, g] of groups) {
    // общий диапазон по всем тирам: позиция числа в шаблоне → min..max
    const tpl = key.replace(/^U:/, '')
    const spans = g.tiers.map(numbers)
    let k = 0
    const text = tpl.replace(/#/g, () => {
      const vals = spans.map((s) => s[k]).filter(Boolean)
      k++
      if (!vals.length) return '#'
      const lo = Math.min(...vals.map((v) => Math.min(v[0], v[1]))), hi = Math.max(...vals.map((v) => Math.max(v[0], v[1])))
      return lo === hi ? String(lo) : `(${lo}-${hi})`
    })
    mods.push({ id: key, text, gen: g.gen, t17: g.t17, match: tpl.toLowerCase().split('\n') })
  }
  mods.sort((a, b) => Number(a.t17) - Number(b.t17) || a.text.localeCompare(b.text))
  // строка, совпадающая со строкой мода карты, — это и есть мод, а не «чужой» текст
  for (const m of mods) for (const l of m.match) corpus.delete(l)
  cache = { mods, corpus: [...corpus] }
  return cache
}
