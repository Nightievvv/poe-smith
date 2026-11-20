/**
 * Стоимость крафтов Horticrafting Station (Harvest) в Crystallised Lifeforce.
 * Источники: https://poedb.tw/us/Horticrafting и https://www.poewiki.net/wiki/Harvest_crafting (сверено 20.11.2026, версия 3.30).
 * Таблицы совпадают; в основной таблице вики смена типа сопротивления/урона ещё по старой цене (500 одного цвета),
 * а в её же истории изменений 3.30 и на poedb — 300 + 300 двух цветов (исходного и целевого), берём её.
 * Rancour — Crystallised Rancour, отдельная валюта.
 */
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type Lifeforce = 'Wild' | 'Vivid' | 'Primal' | 'Sacred'
export interface HarvestCost {
  parts: { lf: Lifeforce; n: number }[]
  rancour?: number
}

/** «Reforge a Rare item with random modifiers, including a <Tag> modifier». Ключ — тег мода в данных игры. */
export const HARVEST_REFORGE: Record<string, { label: string; cost: HarvestCost }> = {
  fire: { label: 'Fire', cost: { parts: [{ lf: 'Wild', n: 50 }] } },
  cold: { label: 'Cold', cost: { parts: [{ lf: 'Vivid', n: 50 }] } },
  lightning: { label: 'Lightning', cost: { parts: [{ lf: 'Primal', n: 50 }] } },
  physical: { label: 'Physical', cost: { parts: [{ lf: 'Vivid', n: 50 }] } },
  life: { label: 'Life', cost: { parts: [{ lf: 'Wild', n: 75 }] } },
  defences: { label: 'Defence', cost: { parts: [{ lf: 'Primal', n: 75 }] } },
  chaos: { label: 'Chaos', cost: { parts: [{ lf: 'Vivid', n: 100 }] } },
  attack: { label: 'Attack', cost: { parts: [{ lf: 'Wild', n: 75 }] } },
  caster: { label: 'Caster', cost: { parts: [{ lf: 'Primal', n: 75 }] } },
  speed: { label: 'Speed', cost: { parts: [{ lf: 'Vivid', n: 150 }] } },
  critical: { label: 'Critical', cost: { parts: [{ lf: 'Primal', n: 150 }] } },
  minion: { label: 'Minion', cost: { parts: [{ lf: 'Primal', n: 200 }], rancour: 3 } },
  elemental: { label: 'Elemental', cost: { parts: [{ lf: 'Wild', n: 200 }], rancour: 1 } },
  attribute: { label: 'Attribute', cost: { parts: [{ lf: 'Vivid', n: 200 }], rancour: 2 } },
  mana: { label: 'Mana', cost: { parts: [{ lf: 'Primal', n: 200 }], rancour: 2 } },
  drop: { label: 'Drop', cost: { parts: [{ lf: 'Vivid', n: 200 }], rancour: 1 } }
}

/** «Add a new <Tag> modifier and remove another random modifier from a non-Influenced item». */
export const HARVEST_AUGMENT: Record<string, { label: string; cost: HarvestCost }> = {
  fire: { label: 'Fire', cost: { parts: [{ lf: 'Wild', n: 15000 }, { lf: 'Sacred', n: 1 }] } },
  cold: { label: 'Cold', cost: { parts: [{ lf: 'Vivid', n: 15000 }, { lf: 'Sacred', n: 1 }] } },
  lightning: { label: 'Lightning', cost: { parts: [{ lf: 'Primal', n: 15000 }, { lf: 'Sacred', n: 1 }] } },
  physical: { label: 'Physical', cost: { parts: [{ lf: 'Vivid', n: 15000 }, { lf: 'Sacred', n: 1 }] } },
  life: { label: 'Life', cost: { parts: [{ lf: 'Wild', n: 17500 }, { lf: 'Sacred', n: 1 }] } },
  defences: { label: 'Defence', cost: { parts: [{ lf: 'Primal', n: 17500 }, { lf: 'Sacred', n: 1 }] } },
  chaos: { label: 'Chaos', cost: { parts: [{ lf: 'Vivid', n: 17500 }, { lf: 'Sacred', n: 1 }] } },
  attack: { label: 'Attack', cost: { parts: [{ lf: 'Wild', n: 17500 }, { lf: 'Sacred', n: 1 }] } },
  caster: { label: 'Caster', cost: { parts: [{ lf: 'Primal', n: 17500 }, { lf: 'Sacred', n: 1 }] } },
  speed: { label: 'Speed', cost: { parts: [{ lf: 'Vivid', n: 20000 }, { lf: 'Sacred', n: 1 }] } },
  critical: { label: 'Critical', cost: { parts: [{ lf: 'Primal', n: 20000 }, { lf: 'Sacred', n: 1 }] } }
}

/**
 * «Change a modifier that grants <A> Resistance/Damage into a similar-tier modifier that grants <B> …»: 300 лайфорса цвета A + 300 цвета B
 * (огонь — Wild, холод — Primal, молния — Vivid); смена типа урона — ещё 1 Crystallised Rancour.
 */
export const RES_LIFEFORCE: Record<'Fire' | 'Cold' | 'Lightning', Lifeforce> = { Fire: 'Wild', Cold: 'Primal', Lightning: 'Vivid' }

export const lifeforceName = (lf: Lifeforce) => `${lf} Crystallised Lifeforce`

export interface HarvestTables {
  /** откуда цифры — показывается в плане */
  source: string
  reforge: Record<string, { label: string; cost: HarvestCost }>
  augment: Record<string, { label: string; cost: HarvestCost }>
  /** лайфорса каждого из двух цветов на смену типа сопротивления или урона */
  resChange: number
  /** Crystallised Rancour на смену типа урона */
  dmgChangeRancour: number
  /** «Reforge a Rare item, being more/less likely to receive the same modifier types» */
  similar: HarvestCost
  /** «Reforge an Influenced Rare item with random modifiers, including a Influence modifier» */
  influenced: HarvestCost
}

const DEFAULTS: HarvestTables = {
  source: 'poedb.tw/us/Horticrafting + poewiki Harvest crafting, 3.30, 20.11.2026',
  reforge: HARVEST_REFORGE,
  augment: HARVEST_AUGMENT,
  resChange: 300,
  dmgChangeRancour: 1,
  similar: { parts: [{ lf: 'Wild', n: 200 }] },
  influenced: { parts: [{ lf: 'Primal', n: 5000 }, { lf: 'Sacred', n: 1 }] }
}

/** Файл с таблицей, который можно править руками, если GGG поменяет стоимость. */
export const harvestFile = () => join(app.getPath('userData'), 'harvest-costs.json')

export function loadHarvest(): HarvestTables {
  const f = harvestFile()
  try {
    if (!existsSync(f)) writeFileSync(f, JSON.stringify(DEFAULTS, null, 2), 'utf-8')
    const raw = JSON.parse(readFileSync(f, 'utf-8')) as Partial<HarvestTables>
    return { ...DEFAULTS, ...raw, source: DEFAULTS.source, reforge: { ...DEFAULTS.reforge, ...(raw.reforge ?? {}) }, augment: { ...DEFAULTS.augment, ...(raw.augment ?? {}) } }
  } catch {
    return DEFAULTS
  }
}

export function resetHarvest() {
  writeFileSync(harvestFile(), JSON.stringify(DEFAULTS, null, 2), 'utf-8')
}
