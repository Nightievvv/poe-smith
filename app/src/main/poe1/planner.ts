import type { CraftCost, CraftPlan, CraftStep, CraftTarget, CraftVariant, Lang, ParsedItem } from '../../shared/types'
import { loadCraftData, matchMod, matchModText, weightFor, type Base, type BenchCraft, type Fossil, type Mod } from './craftdata'
import { getPriceBook } from './ninja'
import { RES_LIFEFORCE, lifeforceName, loadHarvest, type HarvestCost } from './harvest'
import { JEWEL_COUNTS, MAGIC_COUNTS, RARE_COUNTS, prob, simulate, type SimMod, type SimTarget } from './sim'

/** Влияния: суффикс тега в данных игры → название влияния и зверь для «Add a Mod to a … Item». */
const INFLUENCES: { tag: string; name: string; beast: string }[] = [
  { tag: 'shaper', name: 'Shaper', beast: 'Fenumal Devourer' },
  { tag: 'elder', name: 'Elder', beast: 'Saqawine Blood Viper' },
  { tag: 'crusader', name: 'Crusader', beast: 'Farric Goliath' },
  { tag: 'eyrie', name: 'Redeemer', beast: 'Fenumal Queen' },
  { tag: 'basilisk', name: 'Hunter', beast: 'Craicic Watcher' },
  { tag: 'adjudicator', name: 'Warlord', beast: 'Fenumal Scrabbler' }
]
/** Вероятность сохранить все n модов одной стороны при рекомбинации (таблица сообщества для пула из n модов). */
const RECOMB_KEEP_ALL: Record<number, number> = { 1: 0.59, 2: 0.33 }

/**
 * Планировщик крафта. Строит несколько вариантов: основной метод (Currency, Essence, Fossil, Harvest) получает
 * «основной» мод, затем для каждого оставшегося мода — шаг доводки (верстак, Exalted Orb, мета-крафт), который
 * нужен, только если мод не выпал раньше. Стоимость:
 *  - гарантированный метод (эссенция): до «основной мод + один дополнительный»;
 *  - негарантированный (Chaos, Alteration, Fossil, Harvest): только до основного мода;
 *  - доводка: стоимость × вероятность, что мод ещё нужен.
 * Вероятности приближённые (модель «2 случайных мода на сторону» вместо точного выбора без возвращения).
 */

type Source = 'base' | 'exarch' | 'eater' | 'corrupted' | 'enchant' | 'bench' | 'fractured' | 'explicit' | 'influence' | 'unknown'
type Side = 'prefix' | 'suffix'

interface Resolved {
  text: string
  kind: ParsedItem['mods'][number]['kind']
  tier?: string
  gen?: Side
  mod?: Mod
  bench?: BenchCraft
  source: Source
  /** для модов влияния */
  inf?: (typeof INFLUENCES)[number] & { spawnTag: string }
}

interface Primary {
  key: string
  name: string
  mechanics: string[]
  steps: CraftStep[]
  chaos: number
  main: Resolved
  /** вероятность, что мод уже есть после основного метода */
  already: (r: Resolved) => number
  notes: string[]
}

const ELDRITCH_TIERS = ['Lesser', 'Greater', 'Grand', 'Exceptional', 'Exquisite', 'Perfect']
const RESONATORS = ['Primitive Chaotic Resonator', 'Potent Chaotic Resonator', 'Powerful Chaotic Resonator', 'Prime Chaotic Resonator']

function domainOk(mod: Mod, base: Base) {
  if (mod.domain === base.domain) return true
  if (base.itemClass === 'Jewel') return mod.domain === 'jewel'
  if (/Abyss/.test(base.itemClass)) return mod.domain === 'abyss_jewel'
  return false
}

export interface PlanOptions {
  /** свои цены (Chaos) для валюты, которой нет на poe.ninja; перекрывают цены poe.ninja */
  customPrices?: Record<string, number>
  /** цена белой базы нужного уровня (трейд) */
  basePrice?: (baseType: string, ilvl: number) => Promise<{ chaos: number; count: number } | null>
}

export async function buildPlan(item: ParsedItem, targetIdx: number[], lang: Lang, league: string, opts: PlanOptions = {}): Promise<CraftPlan> {
  const T = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const d = await loadCraftData()
  const prices = new Map(await getPriceBook(league).catch(() => new Map<string, number>()))
  for (const [k, v] of Object.entries(opts.customPrices ?? {})) if (v > 0) prices.set(k, v)
  const divine = prices.get('Divine Orb') ?? null
  const warnings: string[] = []
  const missingPrice = new Set<string>()

  const price = (name: string) => {
    const p = prices.get(name)
    if (p == null) missingPrice.add(name)
    return p ?? 0
  }
  const fmtN = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))
  /** фиксированный расход (база, верстак, качество, связи) */
  const cost = (name: string, count: number, label?: string): CraftCost => {
    const p = prices.get(name)
    if (p == null) missingPrice.add(name)
    return { name, count: label ?? `×${fmtN(count)}`, chaos: p != null ? p * count : undefined }
  }
  /** расход на попытки: зависит от удачи, для него считается диапазон 50–100% */
  const costA = (name: string, count: number): CraftCost => ({ ...cost(name, count), count: `×${fmtN(count / 2)}–${fmtN(count)}`, attempts: true })
  const harvestCosts = (h: HarvestCost, times: number): CraftCost[] => [
    ...h.parts.map((p) => costA(lifeforceName(p.lf), p.n * times)),
    ...(h.rancour ? [costA('Crystallised Rancour', h.rancour * times)] : [])
  ]
  const harvestPrice = (h: HarvestCost) => h.parts.reduce((a, p) => a + price(lifeforceName(p.lf)) * p.n, 0) + (h.rancour ? price('Crystallised Rancour') * h.rancour : 0)
  const sum = (cs: CraftCost[]) => cs.reduce((a, c) => a + (c.chaos ?? 0), 0)
  const pct = (p: number) => `${(Math.min(1, p) * 100).toPrecision(2)}%`
  const INV = T('Инвентарь', 'Inventory')
  const BENCH = T('Верстак в убежище (рецепт должен быть открыт)', 'Hideout crafting bench (recipe must be unlocked)')
  const farm = (name: string) =>
    /Essence/.test(name) ? T('Механика Essence в картах; 3 одинаковых эссенции → 1 следующего тира у торговца', 'Essence encounters in maps; 3 of a tier → 1 of the next at a vendor')
      : /Eldritch|Ember|Ichor/.test(name) ? T('Алтари Searing Exarch / Eater of Worlds в картах (нужно влияние на Атласе)', 'Searing Exarch / Eater of Worlds altars in maps (Atlas influence)')
        : /Fossil|Resonator/.test(name) ? T('Delve (Азуритовая шахта); дешевле купить на бирже', 'Delve (Azurite Mine); cheaper on the exchange')
          : /Lifeforce/.test(name) ? T('Harvest (Священная роща) в картах; лайфорс дёшево на бирже', 'Harvest (Sacred Grove) in maps; lifeforce is cheap on the exchange')
            : T('Обычный дроп; дешевле купить на бирже валют в убежище', 'Regular drops; cheaper on the Currency Exchange')

  // ---------- база ----------
  const variants = d.bases.get(item.baseType) ?? []
  const implicitTexts = item.mods.filter((m) => m.kind === 'implicit').map((m) => m.text)
  const base =
    variants.find((b) => b.implicits.length && b.implicits.every((id) => { const bm = d.mods.get(id); return bm && implicitTexts.some((t) => matchModText(bm, t)) })) ??
    variants[0]
  if (!base) {
    return { stage: '', ilvl: item.itemLevel ?? 0, targets: [], variants: [], divine, missingPrices: [],
      warnings: [T(`База «${item.baseType}» не найдена в данных игры.`, `Base "${item.baseType}" not found in game data.`)] }
  }
  const tags = base.tags
  const ilvl = item.itemLevel ?? 86
  const pool = [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, tags) > 0)
  const benchForClass = d.bench.filter((b) => b.itemClasses.includes(base.itemClass))

  // влияния: тег вида "boots_shaper" — тег класса базы + суффикс влияния
  const spawnTags = new Set<string>()
  for (const m of d.mods.values()) for (const w of m.weights) if (/_(shaper|elder|crusader|eyrie|basilisk|adjudicator)$/.test(w.tag)) spawnTags.add(w.tag)
  const infs = INFLUENCES.map((inf) => {
    const spawnTag = [...spawnTags].find((t) => t.endsWith('_' + inf.tag) && tags.includes(t.slice(0, -(inf.tag.length + 1))))
    return spawnTag ? { ...inf, spawnTag } : null
  }).filter((x): x is NonNullable<typeof x> => !!x)
  const infPool = (spawnTag: string) =>
    [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, [spawnTag]) > 0)

  // ---------- сопоставляем выбранные моды с данными игры ----------
  const resolved: Resolved[] = targetIdx.map((i) => {
    const m = item.mods[i]
    const r: Resolved = { text: m.text, kind: m.kind, tier: m.tier, gen: m.gen, source: 'unknown' }
    if (m.kind === 'implicit' || m.kind === 'enchant') {
      if (base.implicits.some((id) => { const bm = d.mods.get(id); return bm && matchModText(bm, m.text) })) r.source = 'base'
      else {
        const eld = [...d.mods.values()].find((x) => (x.gen === 'searing_exarch_implicit' || x.gen === 'eater_of_worlds_implicit') && weightFor(x, tags) > 0 && matchMod(x, [m.text]))
        if (eld) { r.mod = eld; r.source = eld.gen === 'searing_exarch_implicit' ? 'exarch' : 'eater' }
        else {
          const cor = [...d.mods.values()].find((x) => x.gen === 'corrupted' && weightFor(x, tags) > 0 && matchMod(x, [m.text]))
          if (cor) { r.mod = cor; r.source = 'corrupted' }
          else if (m.kind === 'enchant') r.source = 'enchant'
        }
      }
      return r
    }
    if (m.kind === 'crafted') {
      const b = benchForClass.find((bc) => { const bm = d.mods.get(bc.modId); return bm && matchMod(bm, [m.text]) })
      if (b) { r.bench = b; r.mod = d.mods.get(b.modId); r.source = 'bench' }
      return r
    }
    const cands = pool.filter((x) => (!m.gen || x.gen === m.gen) && matchMod(x, [m.text])).sort((a, b) => b.reqLevel - a.reqLevel)
    const mod = cands.find((x) => x.reqLevel <= ilvl) ?? cands[0]
    if (mod) { r.mod = mod; r.gen = mod.gen as Side; r.source = m.kind === 'fractured' ? 'fractured' : 'explicit' }
    else {
      // нет в обычном пуле — ищем среди модов влияний (Shaper, Elder, Conquerors)
      for (const inf of infs) {
        const ic = infPool(inf.spawnTag).filter((x) => matchMod(x, [m.text])).sort((a, b) => b.reqLevel - a.reqLevel)
        const im = ic.find((x) => x.reqLevel <= ilvl) ?? ic[0]
        if (im) { r.mod = im; r.gen = im.gen as Side; r.source = 'influence'; r.inf = inf; break }
      }
    }
    return r
  })

  const tierOf = (mod: Mod) => {
    const same = pool.filter((x) => x.type === mod.type && x.gen === mod.gen).sort((a, b) => b.reqLevel - a.reqLevel)
    const i = same.findIndex((x) => x.id === mod.id)
    return i >= 0 ? `${mod.gen === 'suffix' ? 'S' : 'P'}${i + 1}` : undefined
  }

  // не больше одного крафтового мода на предмете
  const craftedTargets = resolved.filter((r) => r.source === 'bench')
  if (craftedTargets.length > 1) {
    warnings.push(T('На предмете может быть только один мод с верстака — оставляю первый, остальные будут случайными аффиксами.',
      'An item can hold only one bench craft: keeping the first, the rest become random affixes.'))
    for (const r of craftedTargets.slice(1)) {
      const cands = pool.filter((x) => matchMod(x, [r.text])).sort((a, b) => b.reqLevel - a.reqLevel)
      if (cands[0]) { r.mod = cands[0]; r.gen = cands[0].gen as Side; r.source = 'explicit'; r.bench = undefined }
    }
  }

  const explicit = resolved.filter((r) => r.source === 'explicit')
  const fractured = resolved.filter((r) => r.source === 'fractured')
  const influenced = resolved.filter((r) => r.source === 'influence')
  const infGroups = [...new Set(influenced.map((r) => r.inf!.tag))].map((tag) => influenced.filter((r) => r.inf!.tag === tag))
  const need = Math.max(base.dropLevel, ...[...explicit, ...fractured, ...influenced].map((r) => r.mod!.reqLevel))
  const stage =
    need <= 45 ? T('Акты 1–5', 'Acts 1–5')
      : need <= 67 ? T('Акты 6–10', 'Acts 6–10')
        : need <= 72 ? T('Карты T1–T5', 'Maps T1–T5')
          : need <= 78 ? T('Карты T6–T10', 'Maps T6–T10')
            : need <= 83 ? T('Карты T11–T16', 'Maps T11–T16')
              : T('Карты T16+ (ilvl 84+ — боссы T16 и T17) или покупка базы', 'Maps T16+ (ilvl 84+: T16 bosses, T17) or buy the base')

  const SOURCE: Record<Source, string> = {
    base: T('имплисит базы', 'base implicit'), exarch: 'Searing Exarch', eater: 'Eater of Worlds', corrupted: T('порча (Vaal)', 'corruption (Vaal)'),
    enchant: T('энчант', 'enchant'), bench: T('верстак', 'crafting bench'), fractured: 'fractured', explicit: T('случайный аффикс', 'random affix'),
    influence: T('мод влияния', 'influence mod'),
    unknown: T('не найден в данных игры', 'not found in game data')
  }
  const targets: CraftTarget[] = resolved.map((r) => ({
    text: r.text, kind: r.kind, tier: r.tier ?? (r.mod && (r.source === 'explicit' || r.source === 'fractured') ? tierOf(r.mod) : undefined),
    gen: r.kind === 'implicit' || r.kind === 'enchant' ? 'implicit' : r.gen, found: r.source !== 'unknown',
    source: r.source === 'influence' ? `${SOURCE.influence}: ${r.inf!.name}` : SOURCE[r.source]
  }))
  for (const r of resolved) if (r.source === 'unknown') warnings.push(T(`Не нашёл «${r.text}» в данных игры — шаг для него не построен.`, `"${r.text}" not found in game data; no step for it.`))

  // ---------- вероятности (с учётом фоссилий) ----------
  const rollable = pool.filter((x) => x.reqLevel <= Math.max(need, ilvl))
  const mult = (m: Mod, fs: Fossil[]) => {
    let k = 1
    for (const f of fs) for (const w of f.weights) if (m.tags.includes(w.tag)) k *= w.mult
    return k
  }
  const W = (side: Side, fs: Fossil[] = []) => rollable.filter((x) => x.gen === side).reduce((a, x) => a + weightFor(x, tags) * mult(x, fs), 0)
  const wAtLeast = (m: Mod, fs: Fossil[] = []) =>
    rollable.filter((x) => x.type === m.type && x.gen === m.gen && x.reqLevel >= m.reqLevel).reduce((a, x) => a + weightFor(x, tags) * mult(x, fs), 0)
  const share = (r: Resolved, fs: Fossil[] = []) => wAtLeast(r.mod!, fs) / Math.max(1e-9, W(r.mod!.gen as Side, fs))
  const pOn = (r: Resolved, picks: number, fs: Fossil[] = []) => 1 - Math.pow(1 - share(r, fs), picks)
  const names = (rs: Resolved[]) => rs.map((r) => `«${r.text}»`).join(', ')

  // ---------- симуляция роллов (Монте-Карло): группы модов, лимит сторон, число модов ----------
  const isJewel = /Jewel/.test(base.itemClass)
  const rareCounts = isJewel ? JEWEL_COUNTS : RARE_COUNTS
  const maxSide = isJewel ? 2 : 3
  const toSim = (x: Mod, w: number): SimMod => ({ type: x.type, gen: x.gen as Side, reqLevel: x.reqLevel, groups: x.groups, w })
  const simPool = (fs: Fossil[] = []) => rollable.map((x) => toSim(x, weightFor(x, tags) * mult(x, fs))).filter((m) => m.w > 0)
  const simTargets: SimTarget[] = explicit.map((r) => ({ type: r.mod!.type, gen: r.mod!.gen as Side, reqLevel: r.mod!.reqLevel }))
  const bit = (r: Resolved) => (explicit.includes(r) ? 1 << explicit.indexOf(r) : 0)
  const bits = (rs: Resolved[]) => rs.reduce((a, r) => a | bit(r), 0)
  const sim = (o: { fs?: Fossil[]; forced?: Mod[]; forcedFrom?: Mod[]; magic?: boolean }) =>
    simulate(simPool(o.fs), simTargets, {
      counts: o.magic ? MAGIC_COUNTS : rareCounts,
      maxSide: o.magic ? 1 : maxSide,
      forced: o.forced?.map((m) => toSim(m, 1)),
      forcedFrom: o.forcedFrom?.map((m) => toSim(m, weightFor(m, tags))).filter((m) => m.w > 0)
    })
  /** P(мод r есть | условие cond выполнено) */
  const cond = (masks: Uint32Array, r: Resolved, all: number, any = 0) => {
    const base = prob(masks, all, any)
    return base > 0 ? Math.min(1, prob(masks, all | bit(r), any) / base) : 0
  }

  // самый трудный мод — основной для негарантированных методов
  const hardest = [...explicit].sort((a, b) => share(a) - share(b))[0]
  const HORTI = T('Horticrafting Station в убежище', 'Hideout Horticrafting Station')
  const BEAST_SRC = T('Рецепт сверен с poewiki.net/wiki/Beastcrafting (версия 3.30).', 'Recipe checked against poewiki.net/wiki/Beastcrafting (3.30).')
  const H = loadHarvest()
  const HARVEST_SRC = T(`Стоимость Harvest — из таблицы ${H.source} (её можно поправить в Настройках).`, `Harvest costs from ${H.source} (editable in Settings).`)

  // моды влияния: шанс среди всех модов этого влияния (влиянные Exalted и зверь добавляют мод любой стороны)
  const infShare = (r: Resolved) => {
    const ip = infPool(r.inf!.spawnTag).filter((x) => x.reqLevel <= Math.max(need, ilvl))
    const Wi = ip.reduce((a, x) => a + weightFor(x, [r.inf!.spawnTag]), 0)
    const w = ip.filter((x) => x.type === r.mod!.type && x.gen === r.mod!.gen && x.reqLevel >= r.mod!.reqLevel).reduce((a, x) => a + weightFor(x, [r.inf!.spawnTag]), 0)
    return w / Math.max(1e-9, Wi)
  }

  // ---------- основные методы ----------
  const primaries: Primary[] = []
  if (explicit.length) {
    const others = (main: Resolved) => explicit.filter((x) => x !== main)
    const extrasNote = (main: Resolved) =>
      others(main).length
        ? T(`Могут выпасть и другие нужные моды: ${names(others(main))}. Если выпали — пропустите их шаги доводки.`,
          `Other wanted mods may also roll: ${names(others(main))}. If they do, skip their finishing steps.`)
        : undefined

    // Currency: Chaos Orb
    {
      const masks = sim({})
      const p = Math.max(1e-6, prob(masks, bit(hardest)))
      const cs = [cost('Orb of Alchemy', 1), costA('Chaos Orb', 1 / p)]
      primaries.push({
        key: 'chaos', name: 'Chaos Orb', mechanics: ['Currency'], main: hardest, chaos: sum(cs), notes: [],
        already: (r) => (r === hardest ? 1 : cond(masks, r, bit(hardest))),
        steps: [{ kind: 'explicit', title: T(`Chaos Orb до «${hardest.text}»`, `Chaos Orb until "${hardest.text}"`),
          detail: [T(`Шанс за попытку ≈ ${pct(p)}. Начните с редкой базы (Orb of Alchemy).`, `≈ ${pct(p)} per try. Start from a rare base (Orb of Alchemy).`), extrasNote(hardest)].filter(Boolean).join(' '),
          currency: cs, station: INV, farm: farm('Chaos Orb') }]
      })
    }

    // Currency: Alteration (магический предмет) + Regal
    {
      const pa = Math.max(1e-6, prob(sim({ magic: true }), bit(hardest)))
      const second = explicit.filter((x) => x.mod!.gen !== hardest.mod!.gen).sort((a, b) => share(a) - share(b))[0]
      const cs = [cost('Orb of Transmutation', 1), costA('Orb of Alteration', 1 / pa)]
      const steps: CraftStep[] = [
        { kind: 'explicit', title: T(`Магический предмет: Orb of Alteration до «${hardest.text}»`, `Magic item: Alteration until "${hardest.text}"`),
          detail: T(`Шанс за попытку ≈ ${pct(pa)}.`, `≈ ${pct(pa)} per try.`), currency: cs, station: INV, farm: farm('Orb of Alteration') }
      ]
      if (second)
        steps.push({ kind: 'explicit', optional: true, title: T(`Orb of Augmentation на «${second.text}»`, `Augmentation for "${second.text}"`),
          detail: T(`Если второй слот свободен. Шанс ≈ ${pct(share(second))}; промах не страшен — мод доведём позже.`, `If the other slot is free. ≈ ${pct(share(second))}; a miss is fine, it gets finished later.`),
          currency: [cost('Orb of Augmentation', 1)], station: INV, farm: farm('Orb of Augmentation') })
      steps.push({ kind: 'explicit', title: T('Regal Orb: сделать редким (+1 случайный мод)', 'Regal Orb: make it rare (+1 random mod)'),
        detail: extrasNote(hardest), currency: [cost('Regal Orb', 1)], station: INV, farm: farm('Regal Orb') })
      primaries.push({
        key: 'alt', name: 'Alteration + Regal', mechanics: ['Currency'], main: hardest, notes: [],
        chaos: sum(cs) + price('Regal Orb') + (second ? price('Orb of Augmentation') : 0),
        already: (r) => (r === hardest ? 1 : r === second ? share(r) : share(r) * 0.5),
        steps
      })
    }

    // Essence: основной мод гарантирован, ждём ещё один-два из нужных
    for (const main of explicit) {
      const ess = d.essences
        .filter((e) => { const em = d.mods.get(e.mods[base.itemClass]); return em && em.type === main.mod!.type && em.reqLevel >= main.mod!.reqLevel })
        .sort((a, b) => (prices.get(a.name) ?? 1e9) - (prices.get(b.name) ?? 1e9) || a.level - b.level)[0]
      if (!ess) continue
      const rest = others(main)
      const masks = sim({ forced: [d.mods.get(ess.mods[base.itemClass])!] })
      const anyRest = bits(rest)
      const pAdd = rest.length ? Math.max(1e-6, prob(masks, 0, anyRest)) : 1
      const cs = [costA(ess.name, 1 / pAdd)]
      primaries.push({
        key: 'ess-' + ess.name, name: T(`Эссенция: ${ess.name}`, `Essence: ${ess.name}`), mechanics: ['Essence'], main, chaos: sum(cs), notes: [],
        already: (r) => (r === main ? 1 : rest.length ? cond(masks, r, 0, anyRest) : 0),
        steps: [{ kind: 'explicit',
          title: rest.length
            ? T(`Катать ${ess.name}: «${main.text}» гарантирован, ждём ещё 1–2 из: ${names(rest)}`, `Spam ${ess.name}: "${main.text}" is guaranteed, wait for 1–2 of: ${names(rest)}`)
            : T(`Применить ${ess.name}: гарантирует «${main.text}»`, `Use ${ess.name}: guarantees "${main.text}"`),
          detail: rest.length
            ? T(`Стоимость посчитана до «основной + один дополнительный» (шанс за попытку ≈ ${pct(pAdd)}). Остальные моды — шагами доводки ниже.`,
              `Cost counts until "main + one extra" (≈ ${pct(pAdd)} per try). Remaining mods are finished below.`)
            : undefined,
          currency: cs, station: INV, farm: farm(ess.name) }]
      })
    }

    // Harvest: реролл с гарантированным модом тега; тег выбираем самый выгодный по таблице стоимостей
    if (base.domain !== 'flask') {
      const opts = Object.entries(H.reforge)
        .filter(([tag]) => hardest.mod!.tags.includes(tag))
        .map(([tag, h]) => {
          const tagW = rollable.filter((x) => x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
          const pTag = wAtLeast(hardest.mod!) / Math.max(1, tagW)
          const p = Math.max(pTag, pOn(hardest, 2))
          return { tag, h, pTag, p, chaos: harvestPrice(h.cost) / p }
        })
        .sort((a, b) => a.chaos - b.chaos)
      const best = opts[0]
      // уточняем шанс симуляцией: один мод гарантированно из модов тега, остальные случайны
      let masks: Uint32Array | null = null
      if (best) {
        masks = sim({ forcedFrom: rollable.filter((x) => x.tags.includes(best.tag)) })
        best.p = Math.max(1e-6, prob(masks, bit(hardest)))
      }
      if (best) {
        const cs = harvestCosts(best.h.cost, 1 / best.p)
        const lfText = best.h.cost.parts.map((x) => `${x.n} ${x.lf}`).join(' + ') + (best.h.cost.rancour ? ` + ${best.h.cost.rancour} Rancour` : '')
        primaries.push({
          key: 'harvest', name: T(`Harvest: реролл с модом ${best.h.label}`, `Harvest: reforge with a ${best.h.label} modifier`), mechanics: ['Harvest'], main: hardest, chaos: sum(cs),
          notes: [HARVEST_SRC],
          already: (r) => (r === hardest ? 1 : cond(masks!, r, bit(hardest))),
          steps: [{ kind: 'explicit', title: T(`Harvest «Reforge a Rare item … including a ${best.h.label} modifier» до «${hardest.text}»`, `Harvest "Reforge a Rare item … including a ${best.h.label} modifier" until "${hardest.text}"`),
            detail: [T(`Один реролл: ${lfText} лайфорса. Гарантирует мод ${best.h.label}; нужный среди них ≈ ${pct(best.pTag)}.`, `One reforge: ${lfText} lifeforce. Guarantees a ${best.h.label} mod; the wanted one ≈ ${pct(best.pTag)}.`), extrasNote(hardest)].filter(Boolean).join(' '),
            currency: cs, station: HORTI, farm: farm('Lifeforce') }]
        })
      }
    }

    // Fossil: подбираем 1–2 фоссилии, которые усиливают основной мод и не блокируют нужные
    if (base.domain !== 'flask') {
      const ok = d.fossils.filter((f) => prices.has(f.name) && explicit.every((r) => mult(r.mod!, [f]) > 0))
      const boosting = ok.filter((f) => mult(hardest.mod!, [f]) > 1)
      const combos: Fossil[][] = [...boosting.map((f) => [f])]
      for (const a of boosting) for (const b of ok) if (a !== b && !combos.some((c) => c.length === 2 && c.includes(a) && c.includes(b))) combos.push([a, b])
      const best = combos.map((fs) => {
        const p = pOn(hardest, 2, fs)
        const per = fs.reduce((a, f) => a + price(f.name), 0) + price(RESONATORS[fs.length - 1])
        return { fs, p, chaos: per / Math.max(1e-9, p) }
      }).sort((a, b) => a.chaos - b.chaos)[0]
      if (best) {
        // лучшую комбинацию уточняем симуляцией с изменёнными весами
        const masks = sim({ fs: best.fs })
        best.p = Math.max(1e-6, prob(masks, bit(hardest)))
        const tries = 1 / best.p
        const cs = [...best.fs.map((f) => costA(f.name, tries)), costA(RESONATORS[best.fs.length - 1], tries)]
        const label = best.fs.map((f) => f.name).join(' + ')
        primaries.push({
          key: 'fossil', name: T(`Фоссилии: ${label}`, `Fossils: ${label}`), mechanics: ['Fossil'], main: hardest, chaos: sum(cs), notes: [],
          already: (r) => (r === hardest ? 1 : cond(masks, r, bit(hardest))),
          steps: [{ kind: 'explicit', title: T(`${RESONATORS[best.fs.length - 1]} + ${label} до «${hardest.text}»`, `${RESONATORS[best.fs.length - 1]} + ${label} until "${hardest.text}"`),
            detail: [T(`Шанс за попытку ≈ ${pct(best.p)} (без фоссилий ≈ ${pct(pOn(hardest, 2))}).`, `≈ ${pct(best.p)} per try (without fossils ≈ ${pct(pOn(hardest, 2))}).`), extrasNote(hardest)].filter(Boolean).join(' '),
            currency: cs, station: INV, farm: farm('Fossil') }]
        })
      }
    }

    // Alteration + Imprint: поймать два мода на магическом, снять отпечаток (Craicic Croaker), Regal/Exalted на остальные;
    // промах — восстановить отпечаток, а не катать Alteration заново
    {
      const second = explicit.filter((x) => x.mod!.gen !== hardest.mod!.gen).sort((a, b) => share(a) - share(b))[0]
      const rest = explicit.filter((x) => x !== hardest && x !== second)
      if (second && rest.length >= 1 && rest.length <= 2 && prices.has('Craicic Croaker')) {
        const alts = 1 / (0.5 * share(hardest) * share(second))
        const augs = alts * 0.5 * share(hardest)
        const pRest = Math.min(1, rest.reduce((a, r) => a * share(r), 1) * (rest.length === 2 ? 2 : 1))
        const attempts = 1 / pRest
        const altPhase = [cost('Orb of Transmutation', 1), costA('Orb of Alteration', alts), costA('Orb of Augmentation', augs)]
        const loop = [costA('Craicic Croaker', attempts), costA('Regal Orb', attempts), ...(rest.length === 2 ? [costA('Exalted Orb', attempts)] : [])]
        primaries.push({
          key: 'imprint', name: 'Alteration + Imprint', mechanics: ['Currency', 'Beastcraft'], main: hardest, chaos: sum(altPhase) + sum(loop), notes: [],
          already: (r) => (r === hardest || r === second || rest.includes(r) ? 1 : pOn(r, 2)),
          steps: [
            { kind: 'explicit', title: T(`Магический предмет: Alteration/Augmentation до «${hardest.text}» + «${second.text}»`, `Magic item: Alteration/Augmentation until "${hardest.text}" + "${second.text}"`),
              detail: T(`Шанс за попытку ≈ ${pct(0.5 * share(hardest) * share(second))}.`, `≈ ${pct(0.5 * share(hardest) * share(second))} per try.`),
              currency: altPhase, station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', title: T(`Бист-крафт «Create an Imprint of a Magic Item» (Craicic Croaker) → Regal${rest.length === 2 ? ' + Exalted' : ''} на ${names(rest)}`,
              `Beastcraft "Create an Imprint of a Magic Item" (Craicic Croaker) → Regal${rest.length === 2 ? ' + Exalted' : ''} for ${names(rest)}`),
              detail: T(`Шанс попасть ≈ ${pct(pRest)}. Промах — восстановить предмет из отпечатка и повторить (каждый раз нужен новый Craicic Croaker). ${BEAST_SRC}`,
                `Hit chance ≈ ${pct(pRest)}. On a miss, restore the item from the imprint and retry (a new Craicic Croaker each time). ${BEAST_SRC}`),
              currency: loop, station: T('Алтарь Menagerie', 'Menagerie altar'), farm: T('Звери — Einhar в картах или трейд', 'Beasts: Einhar in maps or trade') }
          ]
        })
      }
    }

    // Рекомбинатор: два чистых магических предмета (по префиксу и суффиксу) → один редкий со всеми модами
    const pre = explicit.filter((r) => r.mod!.gen === 'prefix').sort((a, b) => share(a) - share(b))
    const suf = explicit.filter((r) => r.mod!.gen === 'suffix').sort((a, b) => share(a) - share(b))
    if (!influenced.length && explicit.length >= 2 && pre.length <= 2 && suf.length <= 2) {
      const A = [pre[0], suf[0]].filter(Boolean)
      const B = [pre[1], suf[1]].filter(Boolean)
      if (B.length) {
        const alts = (ms: Resolved[]) => 1 / ms.reduce((a, r, i) => a * (i === 0 ? 0.5 : 1) * share(r), 1)
        const pKeep = (pre.length ? RECOMB_KEEP_ALL[pre.length] : 1) * (suf.length ? RECOMB_KEEP_ALL[suf.length] : 1)
        const tries = 1 / pKeep
        const recName = base.domain === 'item' && /Ring|Amulet|Belt/.test(base.itemClass) ? 'Jewellery Recombinator'
          : item.props.weapon || /Sword|Axe|Mace|Bow|Staff|Wand|Claw|Dagger|Sceptre/.test(base.itemClass) ? 'Weapon Recombinator' : 'Armour Recombinator'
        const cs = [costA('Orb of Transmutation', 2 * tries), costA('Orb of Alteration', (alts(A) + alts(B)) * tries), costA(recName, tries)]
        const notes = [T('Вероятности рекомбинации — по таблице сообщества (пул из 1 мода: 59% сохранить, из 2: 33% сохранить оба).',
          'Recombination odds use the community table (pool of 1 mod: 59% to keep, of 2: 33% to keep both).')]
        if (!prices.has(recName)) notes.push(T(`Цены ${recName} нет на poe.ninja: рекомбинаторы есть в данных игры, но их доступность в текущей лиге не подтверждена.`,
          `${recName} has no poe.ninja price: recombinators exist in game data, but availability in this league is unconfirmed.`))
        primaries.push({
          key: 'recomb', name: T('Рекомбинатор', 'Recombinator'), mechanics: ['Recombinator', 'Currency'], main: hardest, chaos: sum(cs), notes,
          already: (r) => (explicit.includes(r) ? 1 : 0),
          steps: [
            { kind: 'explicit', title: T(`Предмет A (магический): Alteration/Augmentation до ${names(A)}`, `Item A (magic): Alteration/Augmentation until ${names(A)}`),
              detail: T('Только нужные моды — лишние портят рекомбинацию.', 'Only the wanted mods: extras ruin the recombination.'), currency: [], station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', title: T(`Предмет B (та же база): Alteration/Augmentation до ${names(B)}`, `Item B (same base): Alteration/Augmentation until ${names(B)}`),
              currency: [], station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', title: T(`${recName}: объединить A и B`, `${recName}: combine A and B`),
              detail: T(`Шанс сохранить все моды ≈ ${pct(pKeep)}. При неудаче — снова предметы A и B. Валюта ниже — на весь цикл с повторами.`,
                `≈ ${pct(pKeep)} to keep every mod. On failure, make A and B again. Currency below covers all retries.`),
              currency: cs, station: INV, farm: T('Рекомбинаторы — дроп механики Sentinel / трейд', 'Recombinators: Sentinel drops / trade') }
          ]
        })
      }
    }
  }

  // Awakener's Orb: два мода разных влияний на одном предмете
  if (infGroups.length >= 2) {
    const [ga, gb] = infGroups.map((g) => [...g].sort((a, b) => infShare(a) - infShare(b)))
    const a = ga[0]
    const b = gb[0]
    const pa = infShare(a)
    const pb = infShare(b)
    const exA = `${a.inf!.name}'s Exalted Orb`
    const exB = `${b.inf!.name}'s Exalted Orb`
    const cs = [costA(exA, 1 / pa), costA('Orb of Alchemy', 1 / pa), costA(exB, 1 / pb), costA('Orb of Alchemy', 1 / pb), cost("Awakener's Orb", 1)]
    primaries.push({
      key: 'awakener', name: "Awakener's Orb", mechanics: ['Influence', "Awakener's Orb"], main: a, chaos: sum(cs),
      notes: [T('Чтобы Awakener гарантированно перенёс нужные моды, на каждом из двух предметов должно быть ровно по одному моду влияния.',
        'For Awakener to keep the wanted mods for sure, each of the two items must carry exactly one influence mod.')],
      already: (r) => (r === a || r === b ? 1 : explicit.includes(r) ? pOn(r, 2) : 0),
      steps: [
        { kind: 'explicit', title: T(`Предмет 1: ${exA} на редкую базу без влияния до «${a.text}»`, `Item 1: ${exA} on a non-influenced rare until "${a.text}"`),
          detail: T(`Шанс ≈ ${pct(pa)}; при промахе — новая база (Orb of Alchemy).`, `≈ ${pct(pa)}; on a miss use a fresh base (Orb of Alchemy).`),
          currency: cs.slice(0, 2), station: INV, farm: farm(exA) },
        { kind: 'explicit', title: T(`Предмет 2: ${exB} до «${b.text}»`, `Item 2: ${exB} until "${b.text}"`),
          detail: T(`Шанс ≈ ${pct(pb)}.`, `≈ ${pct(pb)}.`), currency: cs.slice(2, 4), station: INV, farm: farm(exB) },
        { kind: 'explicit', title: T("Awakener's Orb: перенести влияние предмета 1 на предмет 2", "Awakener's Orb: merge item 1 into item 2"),
          detail: T('Остаётся по одному моду каждого влияния, остальные моды перекатываются случайно — их доводим шагами ниже.', 'One mod of each influence stays; the rest reroll and are finished below.'),
          currency: [cs[4]], station: INV, farm: farm("Awakener's Orb") }
      ]
    })
  }

  // ---------- доводка оставшихся модов ----------
  const benchFor = (r: Resolved) => benchForClass.find((b) => { const bm = d.mods.get(b.modId); return bm && bm.type === r.mod!.type && matchMod(bm, [r.text]) })
  const metaFor = (lockSide: Side) => {
    const text = lockSide === 'prefix' ? 'Prefix Modifiers cannot be changed' : 'Suffix Modifiers cannot be changed'
    return benchForClass.find((b) => d.mods.get(b.modId)?.text === text)
  }

  interface Finish { steps: CraftStep[]; chaos: number; mechanics: string[]; usesCraft: boolean }
  function finishOptions(r: Resolved, craftFree: boolean): Finish[] {
    const out: Finish[] = []
    const p = share(r)
    // риск снять уже полученный нужный мод: Annulment и «убрать случайный» бьют по случайному из ~6 модов (~3 на сторону)
    const wantedAll = explicit.length + influenced.length
    const otherSide = r.mod!.gen === 'prefix' ? 'suffix' : 'prefix'
    const wantedOther = [...explicit, ...influenced].filter((x) => x.mod!.gen === otherSide).length
    const keepAny = Math.max(0.1, 1 - (wantedAll - 1) / 6)
    const keepOther = Math.max(0, 1 - wantedOther / 3)
    const title = (how: string) => T(`Если «${r.text}» не выпал: ${how}`, `If "${r.text}" is missing: ${how}`)
    const b = benchFor(r)
    if (b && craftFree) {
      const cs = b.cost.map((c) => cost(c.name, c.count))
      out.push({ chaos: sum(cs), mechanics: ['Bench'], usesCraft: true,
        steps: [{ kind: 'bench', optional: true, title: title(T('верстак', 'crafting bench')),
          detail: T('Единственный крафтовый мод на предмете. Нужен свободный слот.', 'The only bench craft on the item. Needs a free slot.'),
          currency: cs, station: BENCH, farm: farm(b.cost[0]?.name ?? '') }] })
    }
    // Exalted Orb в свободный слот; промах снимаем Orb of Annulment (риск снять нужный мод)
    {
      const cs = [costA('Exalted Orb', 1 / p), costA('Orb of Annulment', (1 / p - 1) / keepAny)]
      out.push({ chaos: sum(cs), mechanics: ['Currency'], usesCraft: false,
        steps: [{ kind: 'explicit', optional: true, title: title(T('Exalted Orb в свободный слот', 'Exalted Orb into a free slot')),
          detail: T(`Шанс ≈ ${pct(p)}. Промах снимается Orb of Annulment, но он убирает случайный мод — может снять нужный.`,
            `≈ ${pct(p)}. A miss is removed with Orb of Annulment, which removes a random mod and may hit a wanted one.`),
          currency: cs, station: INV, farm: farm('Exalted Orb') }] })
    }
    // сопротивление любого типа + Harvest «сменить тип сопротивления» (300 + 300 лайфорса)
    const res = r.text.match(/^\+\d+% to (Fire|Cold|Lightning) Resistance$/)
    if (res) {
      const pAny = Math.min(1, 3 * p)
      const target = res[1] as 'Fire' | 'Cold' | 'Lightning'
      const conv: HarvestCost = { parts: [{ lf: RES_LIFEFORCE[target], n: H.resChange }, { lf: 'Wild', n: H.resChange }] }
      const cs = [costA('Exalted Orb', 1 / pAny), costA('Orb of Annulment', (1 / pAny - 1) / keepAny), ...harvestCosts(conv, 2 / 3)]
      out.push({ chaos: sum(cs), mechanics: ['Currency', 'Harvest'], usesCraft: false,
        steps: [{ kind: 'explicit', optional: true, title: title(T(`Exalted Orb на любое сопротивление того же тира → Harvest: сменить на ${target}`, `Exalted Orb for any resistance of that tier → Harvest: change it to ${target}`)),
          detail: T(`Любое из трёх сопротивлений ≈ ${pct(pAny)}; в 2 из 3 случаев тип меняем на Horticrafting Station (300 + 300 лайфорса). ${HARVEST_SRC}`,
            `Any of three resistances ≈ ${pct(pAny)}; in 2 of 3 cases change the type at the Horticrafting Station (300 + 300 lifeforce). ${HARVEST_SRC}`),
          currency: cs, station: HORTI, farm: farm('Lifeforce') }] })
    }
    // Harvest: добавить мод с тегом и убрать случайный (только без влияния)
    if (!influenced.length) {
      const aug = Object.entries(H.augment)
        .filter(([tag]) => r.mod!.tags.includes(tag))
        .map(([tag, h]) => {
          const tagW = rollable.filter((x) => x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
          const pt = (wAtLeast(r.mod!) / Math.max(1, tagW)) * keepAny
          return { h, pt, chaos: harvestPrice(h.cost) / pt }
        })
        .sort((a, b) => a.chaos - b.chaos)[0]
      if (aug && aug.pt > 0) {
        const cs = harvestCosts(aug.h.cost, 1 / aug.pt)
        out.push({ chaos: sum(cs), mechanics: ['Harvest'], usesCraft: false,
          steps: [{ kind: 'explicit', optional: true, title: title(T(`Harvest: добавить мод ${aug.h.label} и убрать случайный`, `Harvest: add a ${aug.h.label} mod and remove a random one`)),
            detail: T(`Шанс нужного мода ≈ ${pct(aug.pt)}. Убирает случайный мод — может снять нужный. ${HARVEST_SRC}`, `≈ ${pct(aug.pt)} for the wanted mod. Removes a random mod, possibly a wanted one. ${HARVEST_SRC}`),
            currency: cs, station: HORTI, farm: farm('Lifeforce') }] })
      }
    }
    // Бист-крафт: добавить мод нужной стороны, убрать случайный мод другой стороны
    {
      const beast = r.mod!.gen === 'prefix' ? 'Farric Wolf Alpha' : 'Farric Lynx Alpha'
      // нужно не только получить мод, но и не снять нужный с другой стороны
      if (prices.has(beast) && keepOther > 0) {
        const cs = [costA(beast, 1 / (p * keepOther))]
        out.push({ chaos: sum(cs), mechanics: ['Beastcraft'], usesCraft: false,
          steps: [{ kind: 'explicit', optional: true,
            title: title(r.mod!.gen === 'prefix'
              ? T(`бист-крафт «Add a Prefix, Remove a Random Suffix» (${beast})`, `beastcraft "Add a Prefix, Remove a Random Suffix" (${beast})`)
              : T(`бист-крафт «Add a Suffix, Remove a Random Prefix» (${beast})`, `beastcraft "Add a Suffix, Remove a Random Prefix" (${beast})`)),
            detail: T(`Только для редких. Шанс нужного мода ≈ ${pct(p)}; убирает случайный мод другой стороны — подходит, когда там нет нужных модов. Доступные моды определяет уровень зверя, а не ilvl предмета: нужен зверь уровня ${need}+. ${BEAST_SRC}`,
              `Rare items only. ≈ ${pct(p)} for the wanted mod; removes a random mod of the other side, so use it when that side has nothing you need. The beast's level, not item level, decides which mods can roll: use a level ${need}+ beast. ${BEAST_SRC}`),
            currency: cs, station: T('Алтарь Menagerie', 'Menagerie altar'), farm: T('Звери — Einhar в картах или трейд', 'Beasts: Einhar in maps or trade') }] })
      }
    }
    // мета-крафт: закрепить другую сторону, Scouring, Exalted — безопасно для уже полученных модов
    const lock: Side = r.mod!.gen === 'prefix' ? 'suffix' : 'prefix'
    const meta = metaFor(lock)
    if (meta) {
      const cycle = [...meta.cost.map((c) => costA(c.name, c.count / p)), costA('Orb of Scouring', 1 / p), costA('Exalted Orb', 1 / p)]
      out.push({ chaos: sum(cycle), mechanics: ['Meta-craft'], usesCraft: false,
        steps: [{ kind: 'bench', optional: true, title: title(T(`мета-крафт «${d.mods.get(meta.modId)?.text}» → Orb of Scouring → Exalted Orb`, `meta-craft "${d.mods.get(meta.modId)?.text}" → Orb of Scouring → Exalted Orb`)),
          detail: T(`Закреплённая сторона не меняется, Scouring снимает только другую (и крафтовый мод). Шанс за цикл ≈ ${pct(p)}. Мета-мод занимает слот крафта — после него можно снова ставить мод с верстака.`,
            `The locked side stays; Scouring removes only the other side (and the craft). ≈ ${pct(p)} per cycle. The meta mod uses the craft slot; bench again afterwards.`),
          currency: cycle, station: BENCH, farm: farm('Divine Orb') }] })
    }
    return out.sort((a, b) => a.chaos - b.chaos)
  }

  // моды влияния (для вариантов без Awakener): один влиянный Exalted даёт влияние, остальное — зверь «Add a Mod to a … Item»
  function influenceSteps(skipFirst: Set<Resolved>, groups: Resolved[][]): { steps: CraftStep[]; chaos: number } {
    const steps: CraftStep[] = []
    let total = 0
    for (const g of groups) {
      const inf = g[0].inf!
      const sorted = [...g].sort((a, b) => infShare(a) - infShare(b))
      if (!sorted.some((r) => skipFirst.has(r))) {
        const ex = `${inf.name}'s Exalted Orb`
        const cs = [cost(ex, 1)]
        total += sum(cs)
        steps.push({ kind: 'explicit', title: T(`${ex}: добавить влияние ${inf.name}`, `${ex}: add ${inf.name} influence`),
          detail: T(`Предмет должен быть без влияния и со свободным слотом. Добавит случайный мод ${inf.name}: «${sorted[0].text}» с шансом ≈ ${pct(infShare(sorted[0]))}. Повторить влиянный Exalted на том же предмете нельзя — дальше моды влияния добавляет зверь.`,
            `The item must be non-influenced with a free slot. Adds a random ${inf.name} mod: "${sorted[0].text}" ≈ ${pct(infShare(sorted[0]))}. It cannot be repeated on the same item; further influence mods come from the beastcraft.`),
          currency: cs, station: INV, farm: farm(ex) })
      }
      for (const r of sorted) {
        if (skipFirst.has(r)) continue
        const p = infShare(r)
        const cs = [costA(inf.beast, 1 / p), costA('Craicic Maw', 1 / p), costA('Orb of Annulment', 1 / p - 1)]
        total += sum(cs)
        steps.push({ kind: 'explicit', optional: true,
          title: T(`Если «${r.text}» не выпал: бист-крафт «Add a Mod to a ${inf.name} Item» (${inf.beast} + Craicic Maw)`, `If "${r.text}" is missing: beastcraft "Add a Mod to a ${inf.name} Item" (${inf.beast} + Craicic Maw)`),
          detail: T(`Шанс ≈ ${pct(p)}; промах — Orb of Annulment (может снять нужный мод). ${BEAST_SRC}`, `≈ ${pct(p)}; on a miss use Orb of Annulment (may remove a wanted mod). ${BEAST_SRC}`),
          currency: cs, station: T('Алтарь Menagerie', 'Menagerie altar'), farm: T('Звери — Einhar в картах или трейд', 'Beasts: Einhar in maps or trade') })
      }
    }
    return { steps, chaos: total }
  }

  // ---------- общий хвост: база, fractured, крафт с предмета, имплиситы, финиш ----------
  // цена белой базы нужного уровня с трейда (медиана 5 самых дешёвых)
  let bp: { chaos: number; count: number } | null = null
  let bpError = false
  if (opts.basePrice) {
    try {
      bp = await opts.basePrice(base.name, need)
    } catch {
      bpError = true
    }
  }
  const baseCost: CraftCost[] = bp ? [{ name: T(`${base.name}, ilvl ${need}+ (трейд)`, `${base.name}, ilvl ${need}+ (trade)`), count: '×1', chaos: bp.chaos }] : []
  const head: CraftStep[] = [{
    kind: 'base',
    title: T(`База: ${base.name}, ilvl ${need}+`, `Base: ${base.name}, ilvl ${need}+`),
    detail: [
      fractured.length
        ? T(`Нужна база с fractured-модом ${names(fractured)} — ищите на трейде или используйте Fracturing Orb.`, `You need a base with fractured ${names(fractured)}: buy one or use a Fracturing Orb.`)
        : T('Белая база нужного уровня: чем выше ilvl, тем больше доступно высоких тиров.', 'A white base of the required level: higher ilvl unlocks higher tiers.'),
      bp ? T(`Цена — медиана ${bp.count} самых дешёвых белых баз на трейде.`, `Price: median of the ${bp.count} cheapest white bases on trade.`)
        : bpError ? T('Цену базы получить не удалось (трейд недоступен) — она не входит в итог.', 'Could not get the base price (trade unavailable); it is not included.')
          : T('Белых баз этого уровня на трейде нет — цена не входит в итог.', 'No white bases of this level on trade; price not included.')
    ].join(' '),
    currency: [...baseCost, ...(fractured.length ? [cost('Fracturing Orb', 1)] : [])],
    station: T('Трейд или дроп', 'Trade or drops'), farm: stage
  }]
  const tail: CraftStep[] = []
  for (const r of craftedTargets.slice(0, 1)) {
    const b = r.bench!
    tail.push({ kind: 'bench', title: T(`Верстак: «${d.mods.get(b.modId)?.text.replace(/\n/g, ' / ') ?? r.text}»`, `Crafting bench: "${d.mods.get(b.modId)?.text.replace(/\n/g, ' / ') ?? r.text}"`),
      detail: T('Последним шагом крафта: на предмете может быть только один мод с верстака.', 'Last crafting step: an item holds only one bench craft.'),
      currency: b.cost.map((c) => cost(c.name, c.count)), station: BENCH, farm: farm(b.cost[0]?.name ?? '') })
  }
  for (const r of resolved.filter((x) => x.source === 'exarch' || x.source === 'eater')) {
    const eldPool = [...d.mods.values()].filter((x) => x.gen === r.mod!.gen && weightFor(x, tags) > 0)
    const Wd = eldPool.reduce((a, x) => a + weightFor(x, tags), 0)
    const w = eldPool.filter((x) => x.type === r.mod!.type).reduce((a, x) => a + weightFor(x, tags), 0)
    const tierName = ELDRITCH_TIERS.includes(r.tier ?? '') ? r.tier! : 'Grand'
    const cur = `${tierName} Eldritch ${r.source === 'exarch' ? 'Ember' : 'Ichor'}`
    tail.push({ kind: 'implicit',
      title: T(`Имплисит ${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'}: «${r.text}»`, `${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'} implicit: "${r.text}"`),
      detail: T(`Применять ${cur}, пока не выпадет нужный мод (шанс ≈ ${pct(w / Math.max(1, Wd))}). Явные моды не меняются; тир имплисита зависит от тира валюты.`,
        `Apply ${cur} until the mod appears (≈ ${pct(w / Math.max(1, Wd))}). Explicit mods stay; implicit tier follows the currency tier.`),
      currency: [costA(cur, Wd / Math.max(1, w))], station: INV, farm: farm(cur) })
  }
  for (const r of resolved.filter((x) => x.source === 'enchant'))
    tail.push({ kind: 'implicit', title: T(`Энчант: «${r.text}»`, `Enchant: "${r.text}"`),
      detail: T('Энчанты шлемов, ботинок и перчаток — Лабиринт; часть энчантов даёт Harvest.', 'Helmet/boots/gloves enchants come from the Labyrinth; some from Harvest.'),
      currency: [], station: T('Лабиринт', 'Labyrinth'), farm: T('Лабиринт (Eternal для высших энчантов)', 'Labyrinth (Eternal for top enchants)') })
  if (item.props.quality && item.props.quality > 0) {
    const cur = item.props.weapon ? "Blacksmith's Whetstone" : item.props.defence ? "Armourer's Scrap" : null
    tail.push({ kind: 'finish', title: T(`Качество ${item.props.quality}%`, `Quality ${item.props.quality}%`),
      detail: cur ? undefined : T('Для бижутерии — катализаторы под нужные моды; для флаконов — Glassblower\'s Bauble.', 'Jewellery: catalysts for the right mod tags; flasks: Glassblower\'s Bauble.'),
      currency: cur ? [cost(cur, 8, '×4–20')] : [], station: INV, farm: farm(cur ?? '') })
  }
  const links = item.props.sockets?.links ?? 0
  if (links >= 5) {
    // верстак (Orb of Fusing) или бист-крафт «Maximum Possible Links» — что дешевле
    const fusing = [cost('Orb of Fusing', links >= 6 ? 1500 : 150)]
    const morrigan = prices.has('The Black Mórrígan') ? 'The Black Mórrígan' : prices.has('The Black Mórrigan') ? 'The Black Mórrigan' : null
    const beastCs = morrigan && prices.has('Craicic Sand Spitter') ? [cost('Craicic Sand Spitter', 1), cost(morrigan, 1)] : null
    if (beastCs && sum(beastCs) < sum(fusing))
      tail.push({ kind: 'finish', title: T(`Связать гнёзда: бист-крафт «Maximum Possible Links»`, `Link sockets: beastcraft "Maximum Possible Links"`),
        detail: T(`Дешевле, чем ${links >= 6 ? 1500 : 150} Orb of Fusing на верстаке. ${BEAST_SRC}`, `Cheaper than ${links >= 6 ? 1500 : 150} Orbs of Fusing at the bench. ${BEAST_SRC}`),
        currency: beastCs, station: T('Алтарь Menagerie', 'Menagerie altar'), farm: T('The Black Mórrígan — редко в картах T14+', 'The Black Mórrígan: rare in T14+ maps') })
    else
      tail.push({ kind: 'finish', title: T(`Связать ${links} гнёзд`, `Link ${links} sockets`), currency: fusing, station: BENCH, farm: farm('Orb of Fusing') })
  }
  for (const r of resolved.filter((x) => x.source === 'corrupted')) {
    const cp = [...d.mods.values()].filter((x) => x.gen === 'corrupted' && weightFor(x, tags) > 0)
    const Wc = cp.reduce((a, x) => a + weightFor(x, tags), 0)
    const tries = 4 * (Wc / Math.max(1, weightFor(r.mod!, tags)))
    tail.push({ kind: 'finish', title: T(`Порча Vaal Orb: «${r.text}»`, `Vaal Orb corruption: "${r.text}"`),
      detail: T(`Необратимо и всегда последним шагом: каждая попытка требует новой копии предмета. Нужный исход ≈ 1 из ${Math.round(tries)}.`, `Irreversible and always last: every attempt needs a new copy of the item. About 1 in ${Math.round(tries)}.`),
      currency: [costA('Vaal Orb', tries)], station: INV, farm: farm('Vaal Orb') })
  }
  const tailMech = [...new Set(tail.flatMap((s) => (s.kind === 'implicit' && /Eldritch/.test(s.currency[0]?.name ?? '') ? ['Eldritch'] : s.kind === 'bench' ? ['Bench'] : [])))]

  // ---------- собираем варианты ----------
  /** доля «попыток» в сумме: для неё диапазон 50–100% */
  const split = (cs: CraftCost[], k = 1) => ({
    a: cs.filter((c) => c.attempts).reduce((s, c) => s + (c.chaos ?? 0), 0) * k,
    f: cs.filter((c) => !c.attempts).reduce((s, c) => s + (c.chaos ?? 0), 0) * k
  })
  const out: (CraftVariant & { key: string })[] = []
  const assemble = (key: string, name: string, mechanics: string[], body: CraftStep[], weighted: { cs: CraftCost[]; k: number }[], notes: string[]) => {
    let a = 0
    let f = 0
    for (const w of weighted) { const s = split(w.cs, w.k); a += s.a; f += s.f }
    for (const s of [...head, ...tail]) { const x = split(s.currency); a += x.a; f += x.f }
    const mech = new Set(mechanics)
    tailMech.forEach((m) => mech.add(m))
    out.push({ key, name, mechanics: [...mech], steps: [...head, ...body, ...tail], totalChaos: a + f, costMin: f + a / 2, costMax: a + f, notes })
  }

  if (!explicit.length && !infGroups.length) assemble('tail', T('Имплиситы и финиш', 'Implicits and finish'), [], [], [], [])
  if (infGroups.length >= 2)
    warnings.push(T(`На предмете моды двух влияний (${infGroups.map((g) => g[0].inf!.name).join(' + ')}) — собрать их можно только через Awakener's Orb, поэтому другие варианты не показаны.`,
      `The item has mods of two influences (${infGroups.map((g) => g[0].inf!.name).join(' + ')}); only Awakener's Orb combines them, so other options are hidden.`))
  if (!explicit.length && infGroups.length === 1) {
    const inf = influenceSteps(new Set(), infGroups.slice(0, 1))
    assemble('influence', T('Влияние + бист-крафт', 'Influence + beastcraft'), ['Influence', 'Beastcraft'], inf.steps,
      inf.steps.map((s) => ({ cs: s.currency, k: 1 })), infGroups.length > 1 ? [T('Второе влияние — только через Awakener\'s Orb (отдельный вариант).', 'A second influence needs Awakener\'s Orb (separate option).')] : [])
  }
  for (const pr of primaries) {
    // с двумя влияниями без Awakener предмет не собрать — такой вариант был бы неполным
    if (infGroups.length >= 2 && pr.key !== 'awakener') continue
    let craftFree = craftedTargets.length === 0
    const body: CraftStep[] = [...pr.steps]
    const weighted: { cs: CraftCost[]; k: number }[] = pr.steps.map((s) => ({ cs: s.currency, k: 1 }))
    const mech = new Set(pr.mechanics)
    // сначала доводим самые трудные моды — для них выгоднее занять единственный слот крафта
    const rest = explicit.filter((x) => x !== pr.main).sort((a, b) => share(a) - share(b))
    for (const r of rest) {
      const best = finishOptions(r, craftFree)[0]
      if (!best) continue
      const needP = 1 - pr.already(r)
      if (best.usesCraft) craftFree = false
      best.mechanics.forEach((m) => mech.add(m))
      for (const s of best.steps) weighted.push({ cs: s.currency, k: needP })
      body.push(...best.steps.map((s) => ({ ...s, detail: [s.detail, T(`Понадобится с вероятностью ≈ ${pct(needP)}.`, `Needed with ≈ ${pct(needP)} probability.`)].filter(Boolean).join(' ') })))
    }
    const notes = [...pr.notes]
    // моды влияния: Awakener уже дал по одному моду двух влияний; иначе — только одно влияние
    const groups = pr.key === 'awakener' ? infGroups.slice(0, 2) : infGroups.slice(0, 1)
    if (groups.length) {
      const got = new Set<Resolved>(influenced.filter((r) => pr.already(r) >= 1))
      const inf = influenceSteps(got, groups)
      body.push(...inf.steps)
      for (const s of inf.steps) weighted.push({ cs: s.currency, k: 1 })
      mech.add('Influence')
      if (inf.steps.some((s) => s.optional)) mech.add('Beastcraft')
      if (pr.key !== 'awakener' && infGroups.length > 1)
        notes.push(T(`Второе влияние (${infGroups[1][0].inf!.name}) этим путём не получить — смотрите вариант с Awakener's Orb.`, `The second influence (${infGroups[1][0].inf!.name}) needs the Awakener's Orb option.`))
    }
    if (pr.chaos > 0 && divine && pr.chaos > 50 * divine)
      notes.push(T('Основной метод уходит в тысячи попыток — такую комбинацию обычно дешевле купить.', 'The main method takes thousands of tries; buying is usually cheaper.'))
    assemble(pr.key.startsWith('ess-') ? 'essence' : pr.key, pr.name, [...mech], body, weighted, notes)
  }
  out.sort((a, b) => a.costMax - b.costMax)
  // по одному варианту на каждый основной метод (лучшая эссенция из всех), не больше восьми
  const seen = new Set<string>()
  const variantsOut: CraftVariant[] = out
    .filter((v) => (seen.has(v.key) ? false : (seen.add(v.key), true)))
    .slice(0, 8)
    .map(({ key: _k, ...v }) => v)

  if (missingPrice.size) warnings.push(T(`Нет цены на poe.ninja: ${[...missingPrice].join(', ')} — итог по ним занижен.`, `No poe.ninja price for: ${[...missingPrice].join(', ')}; totals are understated.`))
  return { stage, ilvl: need, targets, variants: variantsOut, divine, warnings, missingPrices: [...missingPrice] }
}
