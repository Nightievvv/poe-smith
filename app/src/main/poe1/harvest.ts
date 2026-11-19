/**
 * Стоимость крафтов Horticrafting Station (Harvest) в Crystallised Lifeforce.
 * Источник: https://poedb.tw/us/Horticrafting (снимок от 20.11.2026; дата таблицы на странице не указана).
 * Rancour — Crystallised Rancour, отдельная валюта.
 */
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
  mana: { label: 'Mana', cost: { parts: [{ lf: 'Primal', n: 200 }], rancour: 2 } }
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

/** «Change a modifier that grants <A> Resistance into a similar-tier modifier that grants <B> Resistance»: 300 + 300 лайфорса двух цветов. */
export const RES_LIFEFORCE: Record<'Fire' | 'Cold' | 'Lightning', Lifeforce> = { Fire: 'Wild', Cold: 'Primal', Lightning: 'Vivid' }

export const lifeforceName = (lf: Lifeforce) => `${lf} Crystallised Lifeforce`
