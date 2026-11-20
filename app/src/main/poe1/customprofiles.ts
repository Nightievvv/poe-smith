import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ParsedItem, PcFilter } from '../../shared/types'
import type { Profile } from './profiles'

/** Свои профили рынка: создаются из прайс-чека, хранятся в %APPDATA%/PoESmith/custom-profiles.json. */
const file = () => join(app.getPath('userData'), 'custom-profiles.json')

export function listCustom(): Profile[] {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf-8')) as Profile[]) : []
  } catch {
    return []
  }
}

const write = (list: Profile[]) => writeFileSync(file(), JSON.stringify(list, null, 2), 'utf-8')

const MOD_KINDS: PcFilter['kind'][] = ['pseudo', 'explicit', 'implicit', 'crafted', 'fractured', 'enchant']

/** Профиль из включённых фильтров прайс-чека: моды с порогами, DPS, защита, база, ilvl. */
export function addFromPriceCheck(item: ParsedItem, filters: PcFilter[], name: string): Profile {
  if (!item.slot) throw new Error('NO_SLOT')
  const on = filters.filter((f) => f.enabled && f.matched)
  const p: Profile = {
    id: 'custom-' + Date.now(),
    slot: item.slot,
    name: { ru: name, en: name },
    custom: true,
    rarity: item.rarity === 'Magic' ? 'magic' : 'rare',
    stats: on.filter((f) => MOD_KINDS.includes(f.kind) && f.statId).map((f) => ({ id: f.statId!, min: f.min ?? undefined, max: f.max ?? undefined })),
    // для планировщика крафта — сами тексты модов (без псевдо-сумм)
    targetMods: on.filter((f) => ['explicit', 'fractured', 'crafted'].includes(f.kind)).map((f) => f.label)
  }
  for (const f of on) {
    if (f.kind === 'base') p.type = item.baseType
    else if (f.kind === 'ilvl' && f.min) p.ilvl = f.min
    else if (f.kind === 'weapon' && f.min) {
      if (f.statId === 'pdps') p.pdps = f.min
      if (f.statId === 'edps') p.edps = f.min
    } else if (f.kind === 'defence' && f.min) p.defence = { ...(p.defence ?? {}), [f.statId as 'ar' | 'ev' | 'es']: f.min }
  }
  write([...listCustom(), p])
  return p
}

export function removeCustom(id: string) {
  write(listCustom().filter((p) => p.id !== id))
}
