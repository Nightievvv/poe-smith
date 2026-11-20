import type { CraftCost, CraftPlan, CraftStep, CraftTarget, CraftVariant, Lang, ParsedItem, StepLine } from '../../shared/types'
import { loadCraftData, matchMod, matchModText, weightFor, type BenchCraft, type Fossil, type Mod } from './craftdata'
import { getPriceBook } from './ninja'
import { RES_LIFEFORCE, lifeforceName, loadHarvest, type HarvestCost } from './harvest'
import { JEWEL_COUNTS, MAGIC_COUNTS, RARE_COUNTS, prob, simulate, type SimMod, type SimTarget } from './sim'
import { domainOk } from './modinfo'

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
/** Классы, на которые можно поставить имплиситы Searing Exarch / Eater of Worlds (и применять Eldritch-валюту). */
const ELDRITCH_CLASSES = new Set(['Helmet', 'Body Armour', 'Gloves', 'Boots'])

/**
 * Планировщик крафта. Строит несколько вариантов: основной метод (Currency, Essence, Fossil, Harvest) получает
 * «основной» мод, затем для каждого оставшегося мода — шаг доводки, который нужен, только если мод не выпал раньше.
 * Способ доводки подбирается двумя способами — для всех модов сразу (с учётом единственного слота верстака и мультимода)
 * и для каждого мода по отдельности; в интерфейсе их можно сравнить.
 * Стоимость:
 *  - гарантированный метод (эссенция): до «основной мод + один дополнительный»;
 *  - негарантированный (Chaos, Alteration, Fossil, Harvest): только до основного мода;
 *  - доводка: стоимость × вероятность, что мод ещё нужен.
 * ilvl базы выбирается в диапазоне [мин. уровень нужных модов, ilvl образца]: лишние высокие тиры ненужных модов
 * разбавляют пул, поэтому выгоднее брать базу, на которой их ещё нет.
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
  /** докрафт: мод уже стоит на предмете и остаётся */
  kept?: boolean
  /** докрафт: мод нужно добавить */
  added?: boolean
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

export interface PlanOptions {
  /** свои цены (Chaos) для валюты, которой нет на poe.ninja; перекрывают цены poe.ninja */
  customPrices?: Record<string, number>
  /** цена белой базы в диапазоне ilvl (трейд) */
  basePrice?: (baseType: string, ilvl: number, maxIlvl: number | null) => Promise<{ chaos: number; count: number } | null>
  /** не ограничивать ilvl базы уровнем образца */
  ignoreIlvl?: boolean
  /** докрафт: targetIdx — оставляемые моды предмета, остальные явные моды снимаются; add — моды игры, которые нужно добавить */
  mode?: 'full' | 'finish'
  add?: string[]
}

/** «+42 to maximum Mana» → «+ to maximum Mana»: в шагах показываем тир, а не конкретное значение. */
const stripNums = (text: string) =>
  text.replace(/\d+(?:\.\d+)?%?/g, '').replace(/\(\s*-\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/^\+\s*/, '+ ').trim()

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
  const fmtC = (c: number) => (divine && c >= divine ? `${(c / divine).toFixed(1)} div` : `${Math.max(1, Math.round(c))}c`)
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
  const MENAGERIE = T('Алтарь Menagerie', 'Menagerie altar')
  const BEAST_FARM = T('Звери — Einhar в картах или трейд', 'Beasts: Einhar in maps or trade')
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
    return { stage: '', ilvl: item.itemLevel ?? 0, ilvlMax: null, targets: [], variants: [], divine, missingPrices: [],
      warnings: [T(`База «${item.baseType}» не найдена в данных игры.`, `Base "${item.baseType}" not found in game data.`)] }
  }
  const tags = base.tags
  const ilvl = item.itemLevel ?? 86
  const pool = [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, tags) > 0)
  const benchForClass = d.bench.filter((b) => b.itemClasses.includes(base.itemClass))
  const isJewel = /Jewel/.test(base.itemClass)
  const maxSide = isJewel ? 2 : 3

  // влияния: тег вида "boots_shaper" — тег класса базы + суффикс влияния
  const spawnTags = new Set<string>()
  for (const m of d.mods.values()) for (const w of m.weights) if (/_(shaper|elder|crusader|eyrie|basilisk|adjudicator)$/.test(w.tag)) spawnTags.add(w.tag)
  const infs = INFLUENCES.map((inf) => {
    const spawnTag = [...spawnTags].find((t) => t.endsWith('_' + inf.tag) && tags.includes(t.slice(0, -(inf.tag.length + 1))))
    return spawnTag ? { ...inf, spawnTag } : null
  }).filter((x): x is NonNullable<typeof x> => !!x)
  const infPool = (spawnTag: string) =>
    [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, [spawnTag]) > 0)

  // ---------- усиление явных модов имплиситом «N% increased Explicit X Modifier magnitudes» ----------
  // Значения таких модов выходят за диапазон тира, поэтому при сопоставлении и расчёте защиты их надо масштабировать.
  const mags = item.mods.flatMap((m) => {
    const x = m.text.match(/^(\d+)% increased Explicit (.+) Modifier magnitudes$/i)
    return x ? [{ pct: Number(x[1]), cat: x[2].toLowerCase() }] : []
  })
  const magOf = (mod: Mod) =>
    mags.reduce((a, g) => {
      const t = mod.tags
      const dmg = t.includes('damage')
      const hit =
        g.cat === 'defence' ? t.includes('defences')
          : g.cat === 'elemental damage' ? dmg && ['elemental', 'fire', 'cold', 'lightning'].some((x) => t.includes(x))
            : g.cat === 'caster damage' ? dmg && t.includes('caster')
              : g.cat === 'physical and chaos damage' ? dmg && (t.includes('physical') || t.includes('chaos'))
                : t.includes(g.cat)
      return hit ? a + g.pct : a
    }, 0)
  /** строка подходит моду: точно или с учётом усиления магнитуд (игра округляет вниз — допуск ±1) */
  const fits = (mod: Mod, text: string) => {
    if (matchMod(mod, [text])) return true
    const k = 1 + magOf(mod) / 100
    if (k === 1) return false
    return mod.lines.some((l) => {
      const mm = text.match(l.re)
      if (!mm) return false
      return mm.slice(1).map(Number).every((v, i) => {
        const r = l.ranges[i]
        if (!r) return true
        const [a, b] = r[0] <= r[1] ? r : [r[1], r[0]]
        return Math.abs(v) >= Math.abs(a) * k - 1 && Math.abs(v) <= Math.abs(b) * k + 1
      })
    })
  }

  // ---------- сопоставляем выбранные моды с данными игры ----------
  const resolvedRaw: Resolved[] = targetIdx.map((i) => {
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
      if (b) { r.bench = b; r.mod = d.mods.get(b.modId); r.source = 'bench'; if (r.mod && (r.mod.gen === 'prefix' || r.mod.gen === 'suffix')) r.gen = r.mod.gen }
      return r
    }
    const cands = pool.filter((x) => (!m.gen || x.gen === m.gen) && fits(x, m.text)).sort((a, b) => b.reqLevel - a.reqLevel)
    const mod = cands.find((x) => x.reqLevel <= ilvl) ?? cands[0]
    if (mod) { r.mod = mod; r.gen = mod.gen as Side; r.source = m.kind === 'fractured' ? 'fractured' : 'explicit' }
    else {
      // нет в обычном пуле — ищем среди модов влияний (Shaper, Elder, Conquerors)
      for (const inf of infs) {
        const ic = infPool(inf.spawnTag).filter((x) => fits(x, m.text)).sort((a, b) => b.reqLevel - a.reqLevel)
        const im = ic.find((x) => x.reqLevel <= ilvl) ?? ic[0]
        if (im) { r.mod = im; r.gen = im.gen as Side; r.source = 'influence'; r.inf = inf; break }
      }
    }
    return r
  })
  const finish = opts.mode === 'finish'
  if (finish) {
    for (const r of resolvedRaw) r.kept = true
    const cleanText = (t: string) => t.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1')
    for (const id of opts.add ?? []) {
      const mod = d.mods.get(id)
      if (!mod || (mod.gen !== 'prefix' && mod.gen !== 'suffix')) continue
      // текст с минимальным значением тира: «+(36-41)% to Cold Resistance» → «+36% to Cold Resistance»
      const text = cleanText(mod.text).split('\n')[0].replace(/\((-?[\d.]+)-(-?[\d.]+)\)/g, '$1')
      const b = mod.domain === 'crafted' ? benchForClass.find((x) => x.modId === id) : undefined
      resolvedRaw.push(b
        ? { text, kind: 'crafted', gen: mod.gen as Side, mod, bench: b, source: 'bench', added: true }
        : { text, kind: 'explicit', gen: mod.gen as Side, mod, source: 'explicit', added: true })
    }
  }
  // строки одного гибридного мода (например, «+354 to Armour» и «+352 to Evasion Rating») — это один мод, а не два
  const resolved: Resolved[] = []
  for (const r of resolvedRaw) {
    const same = r.mod && (r.source === 'explicit' || r.source === 'fractured' || r.source === 'influence')
      ? resolved.find((x) => x.mod?.id === r.mod!.id && x.source === r.source)
      : undefined
    if (same) same.text += ' / ' + r.text
    else resolved.push(r)
  }

  const tierIn =(mod: Mod, list: Mod[]) => {
    const same = list.filter((x) => x.type === mod.type && x.gen === mod.gen).sort((a, b) => b.reqLevel - a.reqLevel)
    const i = same.findIndex((x) => x.id === mod.id)
    return i >= 0 ? i + 1 : undefined
  }
  const tierOf = (mod: Mod) => {
    const n = tierIn(mod, pool)
    return n ? `${mod.gen === 'suffix' ? 'S' : 'P'}${n}` : undefined
  }
  /** «≥T3 + to maximum Mana» — тир вместо конкретного значения */
  const label = (r: Resolved) => {
    if (!r.mod) return r.text
    const n = r.source === 'explicit' || r.source === 'fractured' ? tierIn(r.mod, pool) : r.source === 'influence' ? tierIn(r.mod, infPool(r.inf!.spawnTag)) : undefined
    return n ? `≥T${n} ${stripNums(r.text)}` : r.text
  }
  const names = (rs: Resolved[]) => rs.map((r) => `«${label(r)}»`).join(', ')
  const modLines = (rs: Resolved[]): StepLine[] => rs.map((r) => ({ mod: label(r), gen: r.gen }))

  // не больше одного крафтового мода на предмете
  const craftedTargets = resolved.filter((r) => r.source === 'bench')
  if (craftedTargets.length > 1 && finish)
    warnings.push(T('На предмете будет больше одного мода с верстака — понадобится мультимод «Can have up to 3 Crafted Modifiers».', 'More than one bench craft: you need the multimod "Can have up to 3 Crafted Modifiers".'))
  if (craftedTargets.length > 1 && !finish) {
    warnings.push(T('На предмете может быть только один мод с верстака — оставляю первый, остальные будут случайными аффиксами.',
      'An item can hold only one bench craft: keeping the first, the rest become random affixes.'))
    for (const r of craftedTargets.slice(1)) {
      const cands = pool.filter((x) => matchMod(x, [r.text])).sort((a, b) => b.reqLevel - a.reqLevel)
      if (cands[0]) { r.mod = cands[0]; r.gen = cands[0].gen as Side; r.source = 'explicit'; r.bench = undefined }
    }
    craftedTargets.splice(1)
  }

  const explicit = resolved.filter((r) => r.source === 'explicit')
  const fractured = resolved.filter((r) => r.source === 'fractured')
  const influenced = resolved.filter((r) => r.source === 'influence')
  const infGroups = [...new Set(influenced.map((r) => r.inf!.tag))].map((tag) => influenced.filter((r) => r.inf!.tag === tag))
  const need = Math.max(base.dropLevel, ...[...explicit, ...fractured, ...influenced].map((r) => r.mod!.reqLevel))

  // ---------- ilvl базы: от минимального уровня нужных модов до ilvl образца (или без верхней границы) ----------
  // С ростом ilvl открываются новые тиры: высокие тиры нужных модов помогают, а ненужных — разбавляют пул.
  // Берём уровень, на котором произведение шансов всех нужных модов максимально.
  const capIlvl = opts.ignoreIlvl ? 100 : Math.max(need, ilvl)
  const shareAt = (r: Resolved, L: number) => {
    const roll = pool.filter((x) => x.reqLevel <= L && x.gen === r.mod!.gen)
    const all = roll.reduce((a, x) => a + weightFor(x, tags), 0)
    const hit = roll.filter((x) => x.type === r.mod!.type && x.reqLevel >= r.mod!.reqLevel).reduce((a, x) => a + weightFor(x, tags), 0)
    return hit / Math.max(1e-9, all)
  }
  const levels = [...new Set(pool.map((m) => m.reqLevel))].sort((a, b) => a - b)
  let craftIlvl = need
  if (finish) craftIlvl = ilvl // докрафт: ilvl предмета не меняется
  else if (explicit.length) {
    let bestScore = -Infinity
    for (const L of [need, ...levels.filter((l) => l > need && l <= capIlvl)]) {
      const score = explicit.reduce((a, r) => a + Math.log(Math.max(1e-12, shareAt(r, L))), 0)
      if (score > bestScore + 1e-9) { bestScore = score; craftIlvl = L }
    }
  } else craftIlvl = Math.max(need, Math.min(ilvl, capIlvl))
  const nextLevel = levels.find((l) => l > craftIlvl)
  const ilvlMax: number | null = finish ? ilvl : opts.ignoreIlvl
    ? (explicit.length && nextLevel ? nextLevel - 1 : null)
    : Math.max(craftIlvl, Math.min(capIlvl, explicit.length && nextLevel ? nextLevel - 1 : capIlvl))
  const ilvlRange = ilvlMax == null ? `${craftIlvl}+` : ilvlMax === craftIlvl ? String(craftIlvl) : `${craftIlvl}–${ilvlMax}`

  const stage =
    craftIlvl <= 45 ? T('Акты 1–5', 'Acts 1–5')
      : craftIlvl <= 67 ? T('Акты 6–10', 'Acts 6–10')
        : craftIlvl <= 72 ? T('Карты T1–T5', 'Maps T1–T5')
          : craftIlvl <= 78 ? T('Карты T6–T10', 'Maps T6–T10')
            : craftIlvl <= 83 ? T('Карты T11–T16', 'Maps T11–T16')
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
  const rollable = pool.filter((x) => x.reqLevel <= craftIlvl)
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

  // ---------- симуляция роллов (Монте-Карло): группы модов, лимит сторон, число модов ----------
  const rareCounts = isJewel ? JEWEL_COUNTS : RARE_COUNTS
  const toSim = (x: Mod, w: number): SimMod => ({ type: x.type, gen: x.gen as Side, reqLevel: x.reqLevel, groups: x.groups, w })
  const simPool = (fs: Fossil[] = []) => rollable.map((x) => toSim(x, weightFor(x, tags) * mult(x, fs))).filter((m) => m.w > 0)
  // резисты Fire/Cold/Lightning: в симуляции отслеживаем и другие два цвета того же тира (их меняют через Harvest)
  const RES_RE = /^\+\d+% to (Fire|Cold|Lightning) Resistance$/
  const resEl = (r: Resolved) => r.text.match(RES_RE)?.[1] as 'Fire' | 'Cold' | 'Lightning' | undefined
  const altTargets: SimTarget[] = []
  const altBit = new Map<Resolved, number>()
  explicit.forEach((r, i) => {
    let m = 1 << i
    const el = resEl(r)
    if (el)
      for (const e of ['Fire', 'Cold', 'Lightning'].filter((x) => x !== el)) {
        const re = new RegExp(String.raw`^\+\(?\d+(-\d+)?\)?% to ` + e + ' Resistance$')
        const t = rollable.find((x) => x.gen === r.mod!.gen && re.test(x.text))
        if (!t || explicit.length + altTargets.length >= 30) continue
        m |= 1 << (explicit.length + altTargets.length)
        altTargets.push({ type: t.type, gen: t.gen as Side, reqLevel: r.mod!.reqLevel })
      }
    altBit.set(r, m)
  })
  const simTargets: SimTarget[] = [...explicit.map((r) => ({ type: r.mod!.type, gen: r.mod!.gen as Side, reqLevel: r.mod!.reqLevel })), ...altTargets]
  const bit = (r: Resolved) => (explicit.includes(r) ? 1 << explicit.indexOf(r) : 0)
  /** доля роллов, где есть все моды need (резист — любого цвета того же тира) */
  const pSet = (masks: Uint32Array, need: Resolved[]) => {
    if (!need.length) return 1
    const ms = need.map((r) => altBit.get(r) ?? bit(r))
    let hit = 0
    for (let i = 0; i < masks.length; i++) if (ms.every((m) => (masks[i] & m) !== 0)) hit++
    return hit / masks.length
  }
  /** P(мод r есть, и именно нужного цвета | набор S выпал) */
  const pGivenExact = (masks: Uint32Array, r: Resolved, S: Resolved[]) => {
    const ms = S.map((x) => altBit.get(x) ?? bit(x))
    let base = 0, both = 0
    for (let i = 0; i < masks.length; i++) {
      if (!ms.every((m) => (masks[i] & m) !== 0)) continue
      base++
      if (masks[i] & bit(r)) both++
    }
    return base ? both / base : 0
  }
  const pGiven = pGivenExact
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
    const ip = infPool(r.inf!.spawnTag).filter((x) => x.reqLevel <= craftIlvl)
    const Wi = ip.reduce((a, x) => a + weightFor(x, [r.inf!.spawnTag]), 0)
    const w = ip.filter((x) => x.type === r.mod!.type && x.gen === r.mod!.gen && x.reqLevel >= r.mod!.reqLevel).reduce((a, x) => a + weightFor(x, [r.inf!.spawnTag]), 0)
    return w / Math.max(1e-9, Wi)
  }

  // ---------- основные методы ----------
  const primaries: Primary[] = []
  if (explicit.length && !finish) {
    const others = (main: Resolved) => explicit.filter((x) => x !== main)
    const extrasNote = (main: Resolved): StepLine[] =>
      others(main).length
        ? [T('Могут выпасть и другие нужные моды:', 'Other wanted mods may also roll:'), ...modLines(others(main)),
          T('Если выпали — пропустите их шаги доводки.', 'If they do, skip their finishing steps.')]
        : []

    // Currency: Alteration (магический предмет) + Regal
    {
      const pa = Math.max(1e-6, prob(sim({ magic: true }), bit(hardest)))
      const second = explicit.filter((x) => x.mod!.gen !== hardest.mod!.gen).sort((a, b) => share(a) - share(b))[0]
      const cs = [cost('Orb of Transmutation', 1), costA('Orb of Alteration', 1 / pa)]
      const steps: CraftStep[] = [
        { kind: 'explicit', method: 'Currency', title: T(`Магический предмет: Orb of Alteration до «${label(hardest)}»`, `Magic item: Alteration until "${label(hardest)}"`),
          lines: [T(`Шанс за попытку ≈ ${pct(pa)}.`, `≈ ${pct(pa)} per try.`)], currency: cs, station: INV, farm: farm('Orb of Alteration') }
      ]
      if (second)
        steps.push({ kind: 'explicit', method: 'Currency', optional: true, title: T(`Orb of Augmentation на «${label(second)}»`, `Augmentation for "${label(second)}"`),
          lines: [T('Если второй слот свободен.', 'If the other slot is free.'), T(`Шанс ≈ ${pct(share(second))}.`, `≈ ${pct(share(second))}.`),
            T('Промах не страшен — мод доведём позже.', 'A miss is fine: it gets finished later.')],
          currency: [cost('Orb of Augmentation', 1)], station: INV, farm: farm('Orb of Augmentation') })
      steps.push({ kind: 'explicit', method: 'Currency', title: T('Regal Orb: сделать редким (+1 случайный мод)', 'Regal Orb: make it rare (+1 random mod)'),
        lines: extrasNote(hardest), currency: [cost('Regal Orb', 1)], station: INV, farm: farm('Regal Orb') })
      primaries.push({
        key: 'alt', name: 'Alteration + Regal', mechanics: ['Currency'], main: hardest, notes: [],
        chaos: sum(cs) + price('Regal Orb') + (second ? price('Orb of Augmentation') : 0),
        already: (r) => (r === hardest ? 1 : r === second ? share(r) : share(r) * 0.5),
        steps
      })
    }

    // ---------- основные методы с выбором точки остановки ----------
    // Метод можно катать до разного набора модов: только самый трудный, два, три… Чем больше модов ждём,
    // тем дороже основной метод, но дешевле доводка. Перебираем наборы и оставляем самый дешёвый итог.
    // Резисты Fire/Cold/Lightning засчитываются любого цвета того же тира — цвет меняем через Harvest.
    const subsets = (xs: Resolved[], max: number): Resolved[][] => {
      const out: Resolved[][] = [[]]
      for (const x of xs) for (const s of [...out]) if (s.length < max) out.push([...s, x])
      return out
    }
    const swapCost = (el: 'Fire' | 'Cold' | 'Lightning'): HarvestCost => {
      const src = (['Fire', 'Cold', 'Lightning'] as const).filter((e) => e !== el)[0]
      return { parts: [{ lf: RES_LIFEFORCE[src], n: H.resChange }, { lf: RES_LIFEFORCE[el], n: H.resChange }] }
    }
    type StopBase = {
      key: string; name: string; mechanics: string[]; method: string; station: string; farmName: string
      masks: Uint32Array; perTry: (tries: number) => CraftCost[]; title: (S: Resolved[]) => string; lead: StepLine[]
      guaranteed?: Resolved
    }
    const stopPrimaries = (b: StopBase): Primary[] => {
      const out: Primary[] = []
      const free = explicit.filter((x) => x !== b.guaranteed)
      /**
       * Точка остановки: все моды req (резист — любого цвета) и, если задано, хотя бы один из anyOf.
       * Вариант «хотя бы один из» оставляет второй мод на доводку — он выгоден, когда этот мод дёшево довести иначе.
       */
      const emit = (req: Resolved[], anyOf: Resolved[]) => {
        const S = b.guaranteed ? [b.guaranteed, ...req] : req
        if (!S.length) return
        const reqMasks = req.map((x) => altBit.get(x) ?? bit(x))
        const anyMask = anyOf.reduce((a, x) => a | bit(x), 0)
        const ok = (m: number) => reqMasks.every((q) => (m & q) !== 0) && (!anyMask || (m & anyMask) !== 0)
        let hits = 0
        for (let i = 0; i < b.masks.length; i++) if (ok(b.masks[i])) hits++
        const P = hits / b.masks.length
        if (P < 2e-5) return
        /** P(мод r есть точного цвета | точка остановки достигнута) */
        const given = (r: Resolved) => {
          let both = 0
          for (let i = 0; i < b.masks.length; i++) if (ok(b.masks[i]) && b.masks[i] & bit(r)) both++
          return hits ? both / hits : 0
        }
        const cs = b.perTry(1 / P)
        const head = S[0] ?? anyOf[0]
        const steps: CraftStep[] = [{ kind: 'explicit', method: b.method, title: b.title(S.length ? S : [head]),
          lines: [...b.lead,
            ...(req.length ? [T(anyOf.length ? 'Ждём моды:' : 'Ждём все моды сразу:', anyOf.length ? 'Wait for:' : 'Wait for all of:'), ...modLines(req)] : []),
            ...(anyOf.length ? [T('и хотя бы один из:', 'and at least one of:'), ...modLines(anyOf)] : []),
            T(`Шанс за попытку ≈ ${pct(P)}.`, `≈ ${pct(P)} per try.`),
            ...(req.some((r) => resEl(r)) ? [T('Резист любого цвета того же тира подходит — цвет меняем шагом ниже.', 'A resistance of any colour at that tier counts: change the colour below.')] : []),
            ...(free.length > req.length ? [T('Если заодно выпали другие нужные моды — пропустите их шаги доводки.', 'If other wanted mods roll too, skip their finishing steps.')] : [])],
          currency: cs, station: b.station, farm: farm(b.farmName) }]
        let chaos = sum(cs)
        const mech = [...b.mechanics]
        for (const r of req) {
          const el = resEl(r)
          if (!el) continue
          const pSwap = 1 - given(r)
          if (pSwap < 0.01) continue
          const hc = harvestCosts(swapCost(el), pSwap)
          chaos += sum(hc)
          if (!mech.includes('Harvest')) mech.push('Harvest')
          steps.push({ kind: 'explicit', method: 'Harvest', optional: true,
            title: T(`Если резист не ${el}: Harvest — сменить сопротивление на ${el}`, `If the resistance is not ${el}: Harvest — change it to ${el}`),
            lines: [T(`Понадобится с вероятностью ≈ ${pct(pSwap)}.`, `Needed with ≈ ${pct(pSwap)} probability.`),
              T(`Horticrafting: ${H.resChange} лайфорса цвета исходного резиста + ${H.resChange} цвета ${el}.`, `Horticrafting: ${H.resChange} lifeforce of the source colour + ${H.resChange} of the ${el} colour.`)],
            currency: hc, station: HORTI, farm: farm('Lifeforce') })
        }
        const setS = new Set(S)
        out.push({ key: b.key, name: b.name, mechanics: mech, main: head, chaos, notes: [], steps,
          already: (r) => (setS.has(r) ? 1 : given(r)) })
      }
      for (const req of subsets(free, 4)) emit(req, [])
      // «все из req + хотя бы один из остальных»: остальные доводятся отдельными шагами
      for (const req of subsets(free, 2)) {
        const rest = free.filter((x) => !req.includes(x))
        if (rest.length >= 2) emit(req, rest)
      }
      return out
    }

    // Currency: Chaos Orb
    stopPrimaries({
      key: 'chaos', name: 'Chaos Orb', mechanics: ['Currency'], method: 'Currency', station: INV, farmName: 'Chaos Orb', masks: sim({}),
      perTry: (n) => [cost('Orb of Alchemy', 1), costA('Chaos Orb', n)],
      title: (S) => T(`Chaos Orb до ${S.length > 1 ? `${S.length} нужных модов` : `«${label(S[0])}»`}`, `Chaos Orb until ${S.length > 1 ? `${S.length} wanted mods` : `"${label(S[0])}"`}`),
      lead: [T('Начните с редкой базы (Orb of Alchemy).', 'Start from a rare base (Orb of Alchemy).')]
    }).forEach((p) => primaries.push(p))

    // Essence: мод эссенции гарантирован; ждём ещё набор нужных
    for (const main of explicit) {
      const ess = d.essences
        .filter((e) => { const em = d.mods.get(e.mods[base.itemClass]); return em && em.type === main.mod!.type && em.reqLevel >= main.mod!.reqLevel })
        .sort((a, b) => (prices.get(a.name) ?? 1e9) - (prices.get(b.name) ?? 1e9) || a.level - b.level)[0]
      if (!ess) continue
      stopPrimaries({
        key: 'essence', name: T(`Эссенция: ${ess.name}`, `Essence: ${ess.name}`), mechanics: ['Essence'], method: 'Essence', station: INV, farmName: ess.name,
        masks: sim({ forced: [d.mods.get(ess.mods[base.itemClass])!] }), guaranteed: main,
        perTry: (n) => [costA(ess.name, n)],
        title: (S) => S.length > 1
          ? T(`Катать ${ess.name}: «${label(main)}» гарантирован, ждём ещё ${S.length - 1}`, `Spam ${ess.name}: "${label(main)}" is guaranteed, wait for ${S.length - 1} more`)
          : T(`Применить ${ess.name}: гарантирует «${label(main)}»`, `Use ${ess.name}: guarantees "${label(main)}"`),
        lead: []
      }).forEach((p) => primaries.push(p))
    }

    // Harvest: реролл с гарантированным модом тега (тег — самый выгодный для самого трудного мода)
    if (base.domain !== 'flask') {
      const best = Object.entries(H.reforge)
        .filter(([tag]) => hardest.mod!.tags.includes(tag))
        .map(([tag, h]) => {
          const tagW = rollable.filter((x) => x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
          const p = Math.max(wAtLeast(hardest.mod!) / Math.max(1, tagW), pOn(hardest, 2))
          return { tag, h, chaos: harvestPrice(h.cost) / p }
        })
        .sort((a, b) => a.chaos - b.chaos)[0]
      if (best)
        stopPrimaries({
          key: 'harvest', name: T(`Harvest: реролл с модом ${best.h.label}`, `Harvest: reforge with a ${best.h.label} modifier`), mechanics: ['Harvest'], method: 'Harvest',
          station: HORTI, farmName: 'Lifeforce', masks: sim({ forcedFrom: rollable.filter((x) => x.tags.includes(best.tag)) }),
          perTry: (n) => harvestCosts(best.h.cost, n),
          title: (S) => T(`Harvest «Reforge … including a ${best.h.label} modifier» до ${S.length > 1 ? `${S.length} нужных модов` : `«${label(S[0])}»`}`,
            `Harvest "Reforge … including a ${best.h.label} modifier" until ${S.length > 1 ? `${S.length} wanted mods` : `"${label(S[0])}"`}`),
          lead: [T(`Каждый реролл гарантирует мод ${best.h.label}.`, `Every reforge guarantees a ${best.h.label} mod.`)]
        }).forEach((p) => primaries.push(p))
    }

    // Fossil: 1–3 фоссилии, которые усиливают нужные моды и не блокируют ни один из них
    if (base.domain !== 'flask') {
      const ok = d.fossils.filter((f) => prices.has(f.name) && explicit.every((r) => mult(r.mod!, [f]) > 0))
      const boosting = ok.filter((f) => explicit.some((r) => mult(r.mod!, [f]) > 1)).sort((a, b) => price(a.name) - price(b.name)).slice(0, 8)
      const combos: Fossil[][] = []
      for (let i = 0; i < boosting.length; i++) {
        combos.push([boosting[i]])
        for (let j = i + 1; j < boosting.length; j++) {
          combos.push([boosting[i], boosting[j]])
          for (let k = j + 1; k < boosting.length; k++) combos.push([boosting[i], boosting[j], boosting[k]])
        }
      }
      // грубая оценка «все нужные моды за попытку» для отбора; точный расчёт — симуляцией для лучших трёх
      const rough = combos.map((fs) => {
        const per = fs.reduce((a, f) => a + price(f.name), 0) + price(RESONATORS[fs.length - 1])
        const pAll = explicit.reduce((a, r) => a * pOn(r, 2.5, fs), 1)
        const pHard = pOn(hardest, 2.5, fs)
        return { fs, score: Math.min(per / Math.max(1e-12, pAll), (per / Math.max(1e-12, pHard)) * 3) }
      }).sort((a, b) => a.score - b.score).slice(0, 3)
      for (const { fs } of rough) {
        const lbl = fs.map((f) => f.name).join(' + ')
        const res = RESONATORS[fs.length - 1]
        stopPrimaries({
          key: 'fossil', name: T(`Фоссилии: ${lbl}`, `Fossils: ${lbl}`), mechanics: ['Fossil'], method: 'Fossil', station: INV, farmName: 'Fossil', masks: sim({ fs }),
          perTry: (n) => [...fs.map((f) => costA(f.name, n)), costA(res, n)],
          title: (S) => T(`${res} + ${lbl} до ${S.length > 1 ? `${S.length} нужных модов` : `«${label(S[0])}»`}`, `${res} + ${lbl} until ${S.length > 1 ? `${S.length} wanted mods` : `"${label(S[0])}"`}`),
          lead: []
        }).forEach((p) => primaries.push(p))
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
            { kind: 'explicit', method: 'Currency', title: T('Магический предмет: Alteration/Augmentation до двух модов', 'Magic item: Alteration/Augmentation until two mods'),
              lines: [T('Нужны оба мода:', 'Both mods are needed:'), ...modLines([hardest, second]), T(`Шанс за попытку ≈ ${pct(0.5 * share(hardest) * share(second))}.`, `≈ ${pct(0.5 * share(hardest) * share(second))} per try.`)],
              currency: altPhase, station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', method: 'Beastcraft', title: T(`Бист-крафт «Create an Imprint of a Magic Item» (Craicic Croaker) → Regal${rest.length === 2 ? ' + Exalted' : ''}`,
              `Beastcraft "Create an Imprint of a Magic Item" (Craicic Croaker) → Regal${rest.length === 2 ? ' + Exalted' : ''}`),
              lines: [T('Цель — моды:', 'Target mods:'), ...modLines(rest), T(`Шанс попасть ≈ ${pct(pRest)}.`, `Hit chance ≈ ${pct(pRest)}.`),
                T('Промах — восстановить предмет из отпечатка и повторить (каждый раз нужен новый Craicic Croaker).', 'On a miss, restore the item from the imprint and retry (a new Craicic Croaker each time).'), BEAST_SRC],
              currency: loop, station: MENAGERIE, farm: BEAST_FARM }
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
            { kind: 'explicit', method: 'Currency', title: T('Предмет A (магический): Alteration/Augmentation до модов', 'Item A (magic): Alteration/Augmentation until mods'),
              lines: [...modLines(A), T('Только нужные моды — лишние портят рекомбинацию.', 'Only the wanted mods: extras ruin the recombination.')], currency: [], station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', method: 'Currency', title: T('Предмет B (та же база): Alteration/Augmentation до модов', 'Item B (same base): Alteration/Augmentation until mods'),
              lines: modLines(B), currency: [], station: INV, farm: farm('Orb of Alteration') },
            { kind: 'explicit', method: 'Recombinator', title: T(`${recName}: объединить A и B`, `${recName}: combine A and B`),
              lines: [T(`Шанс сохранить все моды ≈ ${pct(pKeep)}.`, `≈ ${pct(pKeep)} to keep every mod.`), T('При неудаче — снова предметы A и B.', 'On failure, make A and B again.'),
                T('Валюта ниже — на весь цикл с повторами.', 'Currency below covers all retries.')],
              currency: cs, station: INV, farm: T('Рекомбинаторы — дроп механики Sentinel / трейд', 'Recombinators: Sentinel drops / trade') }
          ]
        })
      }
    }
  }

  // Awakener's Orb: два мода разных влияний на одном предмете
  if (infGroups.length >= 2 && !finish) {
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
        { kind: 'explicit', method: 'Influence', title: T(`Предмет 1: ${exA} на редкую базу без влияния до «${label(a)}»`, `Item 1: ${exA} on a non-influenced rare until "${label(a)}"`),
          lines: [T(`Шанс ≈ ${pct(pa)}.`, `≈ ${pct(pa)}.`), T('При промахе — новая база (Orb of Alchemy).', 'On a miss use a fresh base (Orb of Alchemy).')],
          currency: cs.slice(0, 2), station: INV, farm: farm(exA) },
        { kind: 'explicit', method: 'Influence', title: T(`Предмет 2: ${exB} до «${label(b)}»`, `Item 2: ${exB} until "${label(b)}"`),
          lines: [T(`Шанс ≈ ${pct(pb)}.`, `≈ ${pct(pb)}.`)], currency: cs.slice(2, 4), station: INV, farm: farm(exB) },
        { kind: 'explicit', method: "Awakener's Orb", title: T("Awakener's Orb: перенести влияние предмета 1 на предмет 2", "Awakener's Orb: merge item 1 into item 2"),
          lines: [T('Остаётся по одному моду каждого влияния.', 'One mod of each influence stays.'), T('Остальные моды перекатываются случайно — их доводим шагами ниже.', 'The rest reroll and are finished below.')],
          currency: [cs[4]], station: INV, farm: farm("Awakener's Orb") }
      ]
    })
  }

  // ---------- доводка оставшихся модов ----------
  const benchFor = (r: Resolved) => benchForClass.find((b) => { const bm = d.mods.get(b.modId); return bm && bm.type === r.mod!.type && (bm.weights.length === 0 || weightFor(bm, tags) > 0) && matchMod(bm, [r.text]) })
  const benchByText = (text: string) => benchForClass.find((b) => d.mods.get(b.modId)?.text === text)
  const metaFor = (lockSide: Side) => benchByText(lockSide === 'prefix' ? 'Prefix Modifiers cannot be changed' : 'Suffix Modifiers cannot be changed')
  const multimod = benchByText('Can have up to 3 Crafted Modifiers')
  const benchPrice = (b: BenchCraft) => sum(b.cost.map((c) => cost(c.name, c.count)))
  const wantedAll = [...explicit, ...influenced]
  const wantedGroups = new Set(wantedAll.flatMap((x) => x.mod!.groups))
  const exaltP = price('Exalted Orb')
  const annulP = price('Orb of Annulment')
  const sideName = (s: Side) => (s === 'prefix' ? T('префиксы', 'prefixes') : T('суффиксы', 'suffixes'))

  // локальные моды защиты верстака у модов без весов: подходят только базе с этим типом защиты (броня/уклонение/ЭЩ/вард)
  const defOk = (m: Mod) => {
    const need: [RegExp, string][] = [[/Armour/, 'armour'], [/Evasion/, 'evasion'], [/Energy Shield/, 'energy_shield'], [/Ward/, 'ward']]
    if (!/increased (Armour|Evasion|Energy Shield|Ward)|to (Armour|Evasion Rating|maximum Energy Shield|Ward)$/m.test(m.text)) return true
    return need.every(([re, prop]) => !re.test(m.text) || !!base.props[prop])
  }
  // моды верстака стороны, которые не мешают нужным модам (их группы не пересекаются с нужными)
  const sideCrafts = (side: Side) =>
    benchForClass
      .map((b) => ({ b, m: d.mods.get(b.modId) }))
      .filter((x): x is { b: BenchCraft; m: Mod } => !!x.m && x.m.gen === side && (x.m.weights.length === 0 || weightFor(x.m, tags) > 0) && defOk(x.m) && !x.m.groups.some((g) => wantedGroups.has(g)) && !/cannot|Crafted Modifiers/i.test(x.m.text))
  const blockedWeight = (bm: Mod, side: Side) =>
    rollable.filter((x) => x.gen === side && x.groups.some((g) => bm.groups.includes(g))).reduce((a, x) => a + weightFor(x, tags), 0)
  /** самый дешёвый мод верстака, чтобы занять последний свободный слот стороны */
  const fillerCache = new Map<Side, { b: BenchCraft; m: Mod } | null>()
  const filler = (side: Side) => {
    if (!fillerCache.has(side)) fillerCache.set(side, sideCrafts(side).sort((a, b) => benchPrice(a.b) - benchPrice(b.b))[0] ?? null)
    return fillerCache.get(side)!
  }
  /** мод верстака, который снимает с пула больше всего веса стороны (моды одной группы не уживаются на предмете) */
  const blockerCache = new Map<Side, { b: BenchCraft; m: Mod; w: number } | null>()
  const blocker = (side: Side) => {
    if (!blockerCache.has(side))
      blockerCache.set(side, sideCrafts(side)
        .map((x) => ({ ...x, w: blockedWeight(x.m, side) }))
        .filter((x) => x.w > 0)
        .sort((a, b) => b.w - a.w || benchPrice(a.b) - benchPrice(b.b))[0] ?? null)
    return blockerCache.get(side)!
  }
  const craftText = (m: Mod) => m.text.replace(/\n/g, ' / ')
  /** базовая цена вернуть потерянный нужный мод (Exalted + Annulment в свою сторону) — для оценки риска Annulment */
  const refin = (x: Resolved) => (exaltP + annulP) / Math.max(1e-6, share(x))
  const avgRefin = (xs: Resolved[]) => (xs.length ? xs.reduce((a, x) => a + refin(x), 0) / xs.length : 0)

  interface Finish { key: string; short: string; steps: CraftStep[]; chaos: number; mechanics: string[]; usesCraft: boolean }

  /**
   * Цикл «добавить мод → промах снять». Перед Annulment моды верстака снимаются (1 Orb of Scouring), поэтому
   * Annulment выбирает только среди настоящих модов: нужных (exposed) и одного ненужного. Снимать приходится до тех пор,
   * пока не уйдёт ненужный: в среднем (n+2)/2 Annulment и n/2 потерянных нужных модов на промах — их доводим заново.
   */
  const slamCycle = (o: { p: number; slam: string; annul: string; exposed: Resolved[]; once?: CraftCost[]; perMiss?: { name: string; count: number }[]; onHit?: CraftCost[] }) => {
    const N = 1 / Math.max(1e-6, o.p)
    const misses = N - 1
    const n = o.exposed.length
    const miss = (c: CraftCost): CraftCost => ({ ...c, miss: true })
    const cs = [...(o.once ?? []), costA(o.slam, N), ...(misses > 0 ? [miss(costA(o.annul, (misses * (n + 2)) / 2))] : []),
      ...(o.perMiss ?? []).filter(() => misses > 0).map((x) => miss(costA(x.name, x.count * misses))), ...(o.onHit ?? [])]
    const loss = ((misses * n) / 2) * avgRefin(o.exposed)
    return { cs, loss, chaos: sum(cs) + loss }
  }

  const finishCache = new Map<string, Finish[]>()
  /** все способы доводки мода r; present — нужные моды, которые уже стоят на предмете (их может снять Annulment) */
  function finishOptions(r: Resolved, present: Resolved[]): Finish[] {
    const ck = `${wantedAll.indexOf(r)}|${present.map((x) => wantedAll.indexOf(x)).sort().join(',')}`
    const hit = finishCache.get(ck)
    if (hit) return hit
    const out: Finish[] = []
    const p = Math.max(1e-6, share(r))
    const side = r.mod!.gen as Side
    const otherSide: Side = side === 'prefix' ? 'suffix' : 'prefix'
    const sameP = present.filter((x) => x.mod!.gen === side)
    const otherP = present.filter((x) => x.mod!.gen === otherSide)
    // другая сторона уже занята нужными модами — Exalted гарантированно ляжет в нужную сторону
    const otherFull = otherP.length >= maxSide
    const q = otherFull ? 1 : W(side) / Math.max(1e-9, W(side) + W(otherSide))
    // докрафт: новый мод — «Добавить», снятый вместе со стороной — «Вернуть»
    const title = (how: string) => r.added ? T(`Добавить «${label(r)}»: ${how}`, `Add "${label(r)}": ${how}`)
      : r.kept ? T(`Вернуть «${label(r)}»: ${how}`, `Restore "${label(r)}": ${how}`)
        : T(`Если «${label(r)}» не выпал: ${how}`, `If "${label(r)}" is missing: ${how}`)
    const lossLine = (loss: number, who = "Annulment"): StepLine[] =>
      loss > 0.5 ? [T(`${who} может снять уже полученный нужный мод — в цену заложена его повторная доводка (~${fmtC(loss)}).`, `${who} may remove a wanted mod already on the item: re-finishing it is included (~${fmtC(loss)}).`)] : []
    const annulLines = (n: number): StepLine[] => [
      T('Промах: снимите моды верстака (1 Orb of Scouring), затем Orb of Annulment, пока не уйдёт ненужный мод.', 'On a miss: remove bench crafts (1 Orb of Scouring), then Orb of Annulment until the unwanted mod is gone.'),
      ...(n > 0 ? [T(`Сейчас на предмете ~${n} нужных модов — Annulment может снять и их.`, `~${n} wanted mods are on the item: Annulment may hit them too.`)] : [])
    ]
    const push = (f: Finish) => out.push(f)

    // верстак
    const b = benchFor(r)
    if (b) {
      const cs = b.cost.map((c) => cost(c.name, c.count))
      push({ key: 'bench', short: T('Верстак', 'Bench'), chaos: sum(cs), mechanics: ['Bench'], usesCraft: true,
        steps: [{ kind: 'bench', method: 'Bench', optional: true, title: title(T('верстак', 'crafting bench')),
          lines: [T('Мод с верстака; нужен свободный слот.', 'A bench craft; needs a free slot.')],
          currency: cs, station: BENCH, farm: farm(b.cost[0]?.name ?? '') }] })
    }

    // семейства «добавить мод валютой»: обычный Exalted, Exalted на любой резист/урон того же тира + Harvest-смена типа
    type Family = { key: string; short: string; method: string; mech: string[]; pSide: number; how: string; first: StepLine[]; onHit: CraftCost[]; station: string; farm: string }
    const fams: Family[] = [{ key: 'exalt', short: 'Exalted', method: 'Currency', mech: ['Currency'], pSide: p,
      how: T('Exalted Orb', 'Exalted Orb'), first: [], onHit: [], station: INV, farm: farm('Exalted Orb') }]
    const swap = r.text.match(/^\+\d+% to (Fire|Cold|Lightning) Resistance$/) ? { el: r.text.match(/(Fire|Cold|Lightning)/)![1] as 'Fire' | 'Cold' | 'Lightning', dmg: false }
      : r.text.match(/^Adds \d+ to \d+ (Fire|Cold|Lightning) Damage$/) ? { el: r.text.match(/(Fire|Cold|Lightning)/)![1] as 'Fire' | 'Cold' | 'Lightning', dmg: true }
        : null
    if (swap) {
      // источник — любой из двух других элементов (по 1/3 на каждый), цена — 300 его цвета + 300 цвета цели
      const others = (['Fire', 'Cold', 'Lightning'] as const).filter((e) => e !== swap.el)
      const conv = others.flatMap((e) => harvestCosts({ parts: [{ lf: RES_LIFEFORCE[e], n: H.resChange }, { lf: RES_LIFEFORCE[swap.el], n: H.resChange }], rancour: swap.dmg ? H.dmgChangeRancour : undefined }, 1 / 3))
      const what = swap.dmg ? T('любой урон', 'damage') : T('любое сопротивление', 'resistance')
      fams.push({ key: swap.dmg ? 'dmgswap' : 'res', short: swap.dmg ? T('Exalted + Harvest (смена урона)', 'Exalted + Harvest (damage swap)') : T('Exalted + Harvest (смена резиста)', 'Exalted + Harvest (resist swap)'),
        method: 'Harvest', mech: ['Currency', 'Harvest'], pSide: Math.min(1, 3 * p),
        how: T(`Exalted Orb на ${what} того же тира → Harvest: сменить на ${swap.el}`, `Exalted Orb for any ${swap.dmg ? 'damage' : 'resistance'} of that tier → Harvest: change it to ${swap.el}`),
        first: [T(`Подходит любой из трёх элементов того же тира; в 2 из 3 случаев тип меняем на Horticrafting Station (300 + 300 лайфорса${swap.dmg ? ' + Crystallised Rancour' : ''}).`,
          `Any of the three elements of that tier works; in 2 of 3 cases change the type at the Horticrafting Station (300 + 300 lifeforce${swap.dmg ? ' + Crystallised Rancour' : ''}).`), HARVEST_SRC],
        onHit: conv, station: HORTI, farm: farm('Lifeforce') })
    }
    for (const fam of fams) {
      // а) как есть: если другая сторона не заполнена, часть Exalted ляжет туда — это тоже промах
      {
        const pp = fam.pSide * q
        const c = slamCycle({ p: pp, slam: 'Exalted Orb', annul: 'Orb of Annulment', exposed: present, onHit: fam.onHit })
        push({ key: fam.key, short: fam.short + ' + Annulment', chaos: c.chaos, mechanics: fam.mech, usesCraft: false,
          steps: [{ kind: 'explicit', method: fam.method, optional: true, title: title(fam.how),
            lines: [T(`Шанс за попытку ≈ ${pct(pp)}.`, `≈ ${pct(pp)} per try.`),
              ...(q < 1 ? [T(`Другая сторона не заполнена: Exalted попадёт в ${sideName(side)} только в ~${pct(q)} случаев.`, `The other side has free slots: Exalted lands in ${sideName(side)} only ~${pct(q)} of the time.`)] : []),
              ...fam.first, ...annulLines(present.length), ...lossLine(c.loss)],
            currency: c.cs, station: fam.station, farm: fam.farm }] })
      }
      // б) закрыть другую сторону дешёвым модом верстака — Exalted ляжет только в нужную сторону
      const fl = !otherFull ? filler(otherSide) : null
      if (fl) {
        const fc = fl.b.cost.map((x) => ({ name: x.name, count: x.count }))
        const c = slamCycle({ p: fam.pSide, slam: 'Exalted Orb', annul: 'Orb of Annulment', exposed: present,
          once: fl.b.cost.map((x) => cost(x.name, x.count)), perMiss: [{ name: 'Orb of Scouring', count: 1 }, ...fc], onHit: fam.onHit })
        push({ key: fam.key + '-close', short: T(`${fam.short} + закрыть ${sideName(otherSide)}`, `${fam.short} + close ${sideName(otherSide)}`), chaos: c.chaos, mechanics: ['Bench', ...fam.mech], usesCraft: true,
          steps: [{ kind: 'bench', method: fam.method, optional: true, title: title(T(`закрыть ${sideName(otherSide)} модом верстака → ${fam.how}`, `close ${sideName(otherSide)} with a bench craft → ${fam.how}`)),
            lines: [T(`Поставьте на верстаке «${craftText(fl.m)}» в последний свободный слот: тогда Exalted ляжет только в ${sideName(side)}.`, `Craft "${craftText(fl.m)}" into the last free slot: Exalted then lands only in ${sideName(side)}.`),
              T('Если свободных слотов там больше одного — сначала доведите ту сторону.', 'If more than one slot is free there, finish that side first.'),
              T(`Шанс за попытку ≈ ${pct(fam.pSide)}.`, `≈ ${pct(fam.pSide)} per try.`), ...fam.first, ...annulLines(present.length), ...lossLine(c.loss)],
            currency: c.cs, station: BENCH, farm: fam.farm }] })
      }
      // в) другая сторона полна — единственный слот верстака тратим на блок самой частой группы своей стороны
      const bl = otherFull ? blocker(side) : null
      if (bl && !bl.m.groups.some((g) => r.mod!.groups.includes(g))) {
        const pB = (fam.pSide * W(side)) / Math.max(1e-9, W(side) - bl.w)
        const bc = bl.b.cost.map((x) => ({ name: x.name, count: x.count }))
        const c = slamCycle({ p: pB, slam: 'Exalted Orb', annul: 'Orb of Annulment', exposed: present,
          once: bl.b.cost.map((x) => cost(x.name, x.count)), perMiss: [{ name: 'Orb of Scouring', count: 1 }, ...bc], onHit: fam.onHit })
        push({ key: fam.key + '-block', short: T(`${fam.short} + блок «${stripNums(craftText(bl.m))}»`, `${fam.short} + block "${stripNums(craftText(bl.m))}"`), chaos: c.chaos, mechanics: ['Bench', ...fam.mech], usesCraft: true,
          steps: [{ kind: 'bench', method: fam.method, optional: true, title: title(T(`блок модом верстака «${craftText(bl.m)}» → ${fam.how}`, `block with the bench craft "${craftText(bl.m)}" → ${fam.how}`)),
            lines: [T(`Мод с верстака занимает свою группу: Exalted больше не выкатит её моды (−${pct(bl.w / W(side))} веса ${side === 'prefix' ? 'префиксов' : 'суффиксов'}).`, `The bench craft occupies its mod group: Exalted can no longer roll it (−${pct(bl.w / W(side))} of the ${side} weight).`),
              T(`Шанс за попытку растёт с ${pct(fam.pSide)} до ${pct(pB)}.`, `Chance per try rises from ${pct(fam.pSide)} to ${pct(pB)}.`),
              T('Нужно два свободных слота на этой стороне: под блок и под нужный мод.', 'Needs two free slots on this side: one for the block, one for the wanted mod.'),
              ...fam.first, ...annulLines(present.length), ...lossLine(c.loss)],
            currency: c.cs, station: BENCH, farm: fam.farm }] })
      }
    }

    // мета-мод «Cannot roll Attack/Caster Modifiers»: блокирует целую группу модов; это мод верстака, Annulment может снять и его
    for (const [tag, text] of [['attack', 'Cannot roll Attack Modifiers'], ['caster', 'Cannot roll Caster Modifiers']] as const) {
      const mb = benchByText(text)
      if (!mb || r.mod!.tags.includes(tag)) continue
      const blocked = rollable.filter((x) => x.gen === side && x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
      const pb = (wAtLeast(r.mod!) / Math.max(1e-9, W(side) - blocked)) * q
      if (pb < p * q * 1.15) continue
      // мета-мод не снимаем перед Annulment (он дорогой): в пуле Annulment на 1 мод больше, примерно в половине промахов он слетает
      const c = slamCycle({ p: pb, slam: 'Exalted Orb', annul: 'Orb of Annulment', exposed: present, once: mb.cost.map((x) => cost(x.name, x.count)),
        perMiss: [{ name: 'Orb of Annulment', count: 0.5 }, ...mb.cost.map((x) => ({ name: x.name, count: x.count * 0.5 }))] })
      push({ key: 'meta-' + tag, short: `Exalted + «${text}»`, chaos: c.chaos, mechanics: ['Bench', 'Currency'], usesCraft: true,
        steps: [{ kind: 'bench', method: 'Bench', optional: true, title: title(T(`мета-мод «${text}» → Exalted Orb`, `meta mod "${text}" → Exalted Orb`)),
          lines: [T(`Мета-мод убирает из пула моды с тегом ${tag}: шанс за попытку ≈ ${pct(pb)} (без него ${pct(p * q)}).`, `The meta mod removes ${tag} mods from the pool: ≈ ${pct(pb)} per try (${pct(p * q)} without it).`),
            T('Примерно в половине промахов Annulment снимает сам мета-мод — тогда ставим его снова.', 'In about half of the misses Annulment removes the meta mod itself: craft it again.'),
            T('Мета-мод занимает слот верстака — снимите его перед финальным модом с верстака.', 'The meta mod takes the bench slot: remove it before the final bench craft.'), ...lossLine(c.loss)],
          currency: c.cs, station: BENCH, farm: farm('Divine Orb') }] })
    }

    // Eldritch Exalted: при доминировании Searing Exarch добавляет префикс, Eater of Worlds — суффикс;
    // Eldritch Orb of Annulment снимает мод только с доминирующей стороны — другая сторона в безопасности
    if (ELDRITCH_CLASSES.has(base.itemClass) && prices.has('Eldritch Exalted Orb') && prices.has('Eldritch Orb of Annulment')) {
      const dom = side === 'prefix' ? 'Searing Exarch' : 'Eater of Worlds'
      const setup = side === 'prefix' ? 'Lesser Eldritch Ember' : 'Lesser Eldritch Ichor'
      const c = slamCycle({ p, slam: 'Eldritch Exalted Orb', annul: 'Eldritch Orb of Annulment', exposed: sameP, once: [cost(setup, 1)] })
      push({ key: 'eldritch', short: 'Eldritch Exalted', chaos: c.chaos, mechanics: ['Eldritch'], usesCraft: false,
        steps: [{ kind: 'explicit', method: 'Eldritch', optional: true, title: title(T(`Eldritch Exalted Orb при доминировании ${dom}`, `Eldritch Exalted Orb with ${dom} dominance`)),
          lines: [T(`Доминирование ${dom} (его имплисит выше тиром) — новый мод всегда ${side === 'prefix' ? 'префикс' : 'суффикс'}.`, `With ${dom} dominance (higher implicit tier) the new mod is always a ${side}.`),
            T(`Если имплиситов нет — поставьте ${setup}.`, `No implicits yet: apply ${setup}.`), T(`Шанс за попытку ≈ ${pct(p)}.`, `≈ ${pct(p)} per try.`),
            T(`Промах снимается Eldritch Orb of Annulment: при доминировании ${dom} он убирает ${side === 'prefix' ? 'префикс' : 'суффикс'}, другая сторона не страдает.`, `Remove a miss with an Eldritch Orb of Annulment: with ${dom} dominance it removes a ${side}, the other side is safe.`),
            ...lossLine(c.loss)],
          currency: c.cs, station: INV, farm: farm('Eldritch') }] })
    }

    // Harvest: добавить мод с тегом и убрать случайный (только без влияния); снятый мод может оказаться нужным
    if (!influenced.length) {
      const aug = Object.entries(H.augment)
        .filter(([tag]) => r.mod!.tags.includes(tag))
        .map(([tag, h]) => {
          const tagW = rollable.filter((x) => x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
          return { h, pt: wAtLeast(r.mod!) / Math.max(1, tagW) }
        })
        .sort((a, b) => harvestPrice(a.h.cost) / a.pt - harvestPrice(b.h.cost) / b.pt)[0]
      if (aug && aug.pt > 0) {
        // на предмете ~5 модов: нужные present и остальные ненужные
        const n = present.length
        const junk = Math.max(1, 5 - n)
        const lossPer = (n / (n + junk)) * avgRefin(present)
        const cs = harvestCosts(aug.h.cost, 1 / aug.pt)
        const loss = lossPer / aug.pt
        push({ key: 'augment', short: 'Harvest Augment', chaos: sum(cs) + loss, mechanics: ['Harvest'], usesCraft: false,
          steps: [{ kind: 'explicit', method: 'Harvest', optional: true, title: title(T(`Harvest: добавить мод ${aug.h.label} и убрать случайный`, `Harvest: add a ${aug.h.label} mod and remove a random one`)),
            lines: [T(`Шанс нужного мода ≈ ${pct(aug.pt)}.`, `≈ ${pct(aug.pt)} for the wanted mod.`), T('Убирает случайный мод — может снять нужный.', 'Removes a random mod, possibly a wanted one.'), ...lossLine(loss, 'Harvest'), HARVEST_SRC],
            currency: cs, station: HORTI, farm: farm('Lifeforce') }] })
      }
    }

    // Бист-крафт: добавить мод нужной стороны, убрать случайный мод другой стороны.
    // Пока на другой стороне есть ненужные моды, это бесплатно; дальше бист снимает нужные, и их приходится доводить заново.
    {
      const beast = side === 'prefix' ? 'Farric Wolf Alpha' : 'Farric Lynx Alpha'
      if (prices.has(beast)) {
        const N = 1 / p
        const spare = Math.max(0, maxSide - otherP.length)
        const lost = spare === 0 ? N : Math.pow(1 - p, spare) / p
        const c = slamCycle({ p, slam: beast, annul: 'Orb of Annulment', exposed: present })
        const lossOther = lost * avgRefin(otherP)
        push({ key: 'beast', short: T('Бист-крафт', 'Beastcraft'), chaos: c.chaos + lossOther, mechanics: ['Beastcraft'], usesCraft: false,
          steps: [{ kind: 'explicit', method: 'Beastcraft', optional: true,
            title: title(side === 'prefix'
              ? T(`бист-крафт «Add a Prefix, Remove a Random Suffix» (${beast})`, `beastcraft "Add a Prefix, Remove a Random Suffix" (${beast})`)
              : T(`бист-крафт «Add a Suffix, Remove a Random Prefix» (${beast})`, `beastcraft "Add a Suffix, Remove a Random Prefix" (${beast})`)),
            lines: [T('Только для редких.', 'Rare items only.'), T(`Шанс за попытку ≈ ${pct(p)}.`, `≈ ${pct(p)} per try.`),
              T('Промах оставляет ненужный мод — его снимает Orb of Annulment.', 'A miss leaves an unwanted mod: remove it with Orb of Annulment.'),
              T(`Каждая попытка снимает случайный мод другой стороны: ненужных там ~${spare}, дальше начнут сниматься нужные.`, `Each try removes a random mod of the other side: ~${spare} unwanted there, then wanted ones start to go.`),
              ...lossLine(c.loss + lossOther),
              T(`Доступные моды определяет уровень зверя, а не ilvl предмета: нужен зверь уровня ${craftIlvl}+.`, `The beast's level, not item level, decides which mods can roll: use a level ${craftIlvl}+ beast.`), BEAST_SRC],
            currency: c.cs, station: MENAGERIE, farm: BEAST_FARM }] })
      }
    }

    // мета-крафт: закрепить другую сторону, Scouring, Exalted — нужные моды другой стороны в безопасности
    const meta = metaFor(otherSide)
    if (meta) {
      const pm = p * (otherFull ? 1 : 1)
      const cycle = [...meta.cost.map((c) => costA(c.name, c.count / pm)), costA('Orb of Scouring', 1 / pm), costA('Exalted Orb', 1 / pm)]
      // Scouring снимает всю незакреплённую сторону — нужные моды этой же стороны доводятся заново
      const loss = (1 / pm - 1) * sameP.length * avgRefin(sameP)
      push({ key: 'meta', short: T('Мета-крафт', 'Meta-craft'), chaos: sum(cycle) + loss, mechanics: ['Meta-craft'], usesCraft: true,
        steps: [{ kind: 'bench', method: 'Meta-craft', optional: true, title: title(T(`мета-крафт «${d.mods.get(meta.modId)?.text}» → Orb of Scouring → Exalted Orb`, `meta-craft "${d.mods.get(meta.modId)?.text}" → Orb of Scouring → Exalted Orb`)),
          lines: [T('Закреплённая сторона не меняется, Scouring снимает только другую (и крафтовый мод).', 'The locked side stays; Scouring removes only the other side (and the craft).'),
            T(`Шанс за цикл ≈ ${pct(pm)}.`, `≈ ${pct(pm)} per cycle.`),
            T('Цену мета-мода берём из данных игры — сверьте её на своём верстаке.', 'The meta mod cost comes from game data: check it at your bench.'), ...lossLine(loss)],
          currency: cycle, station: BENCH, farm: farm('Divine Orb') }] })
    }
    out.sort((a, c) => a.chaos - c.chaos)
    finishCache.set(ck, out)
    return out
  }

  /** строка «Альтернативы: …» — чтобы было видно, почему выбран этот способ */
  /** альтернативы в описании шага больше не показываем (план и так выбирает самый дешёвый способ) */
  const altLine = (_r: Resolved, _present: Resolved[], _chosen: Finish, _benchFree: boolean): StepLine[] => []

  /** в методе — не больше трёх механик; верстак и мета-крафт — вспомогательные и не считаются */
  const HELPERS = new Set(['Bench', 'Meta-craft'])
  let capOn = true
  const mechOk = (ms: Iterable<string>) => !capOn || new Set([...ms].filter((m) => !HELPERS.has(m))).size <= 3
  interface FinishSet { steps: CraftStep[]; weighted: { cs: CraftCost[]; k: number; extra?: number }[]; mech: Set<string> }
  const withNeed = (s: CraftStep, needP: number, extra: StepLine[]): CraftStep => ({
    ...s, ...(needP >= 0.999 ? { optional: false } : {}),
    lines: [...(s.lines ?? []), ...(needP < 0.999 ? [T(`Понадобится с вероятностью ≈ ${pct(needP)}.`, `Needed with ≈ ${pct(needP)} probability.`)] : []), ...extra]
  })
  /** доп. стоимость, не выраженная в валюте шага (риск снять нужные моды) */
  const extraChaos = (f: Finish) => f.chaos - f.steps.reduce((a, s) => a + sum(s.currency), 0)
  /** нужные моды, которые точно есть после основного метода (и fractured) */
  const initialPresent = (pr: Primary) => [...explicit.filter((x) => pr.already(x) >= 1), ...fractured]
  /** порядки доводки: самые трудные первыми; сначала сторона, где меньше нужных модов (Annulment реже бьёт по нужным) */
  const orders = (rest: Resolved[]): Resolved[][] => {
    const hard = [...rest].sort((a, b) => share(a) - share(b))
    const bySide = (first: Side) => [...hard.filter((x) => x.mod!.gen === first), ...hard.filter((x) => x.mod!.gen !== first)]
    const uniq = new Map<string, Resolved[]>()
    for (const o of [hard, bySide('prefix'), bySide('suffix')]) uniq.set(o.map((x) => wantedAll.indexOf(x)).join(','), o)
    // до четырёх модов перебираем все порядки: цена промаха зависит от того, сколько нужных модов уже на предмете
    if (rest.length <= 4) {
      const perm = (xs: Resolved[]): Resolved[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perm([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])))
      for (const o of perm(rest)) uniq.set(o.map((x) => wantedAll.indexOf(x)).join(','), o)
    }
    return [...uniq.values()]
  }

  const fsCostOf = (fs: FinishSet) => fs.weighted.reduce((a, w) => a + (sum(w.cs) + (w.extra ?? 0)) * w.k, 0)
  /** не больше трёх механик — если только без этого ограничения не выходит заметно дешевле (или мод иначе не довести) */
  const softCap = (f: (pr: Primary) => FinishSet) => (pr: Primary): FinishSet => {
    capOn = true
    const a = f(pr)
    capOn = false
    const b = f(pr)
    capOn = true
    return a.steps.length < b.steps.length || fsCostOf(b) < fsCostOf(a) * 0.9 ? b : a
  }
  const finishSingle = (pr: Primary) => softCap(finishSingleInner)(pr)
  const finishJoint = (pr: Primary) => softCap(finishJointInner)(pr)

  /** по отдельности: самые трудные моды первыми, каждому — самый дешёвый способ на этот момент */
  function finishSingleInner(pr: Primary): FinishSet {
    const set: FinishSet = { steps: [], weighted: [], mech: new Set() }
    let craftFree = craftedTargets.length === 0
    const present = initialPresent(pr)
    const rest = explicit.filter((x) => x !== pr.main && !present.includes(x)).sort((a, b) => share(a) - share(b))
    for (const r of rest) {
      const now = [...present]
      const best = finishOptions(r, now).find((f) => (craftFree || !f.usesCraft) && mechOk([...pr.mechanics, ...set.mech, ...f.mechanics]))
      present.push(r)
      if (!best) continue
      const needP = 1 - pr.already(r)
      const allow = craftFree
      if (best.usesCraft && best.key === 'bench') craftFree = false
      best.mechanics.forEach((m) => set.mech.add(m))
      best.steps.forEach((s, i) => {
        set.weighted.push({ cs: s.currency, k: needP, extra: i === 0 ? extraChaos(best) : 0 })
        set.steps.push({ ...withNeed(s, needP, altLine(r, now, best, allow)), lossChaos: i === 0 ? extraChaos(best) : 0 })
      })
    }
    return set
  }

  /**
   * Для всех модов сразу: перебор порядков доводки и сочетаний способов. Ограничение — один финальный мод верстака
   * (мультимод разрешает больше). Временные крафты (закрыть сторону, блок, мета-моды) снимаются по ходу, поэтому
   * мешают только финальному моду верстака, если он нужен раньше них.
   */
  function finishJointInner(pr: Primary): FinishSet {
    const init = initialPresent(pr)
    const rest = explicit.filter((x) => x !== pr.main && !init.includes(x))
    const multiCost = multimod ? benchPrice(multimod) : 0
    type Best = { order: Resolved[]; opts: Finish[][]; pick: number[]; cost: number; multi: boolean; pMulti: number; needs: number[] }
    let best: Best | null = null
    for (const order of orders(rest)) {
      const needs = order.map((r) => 1 - pr.already(r))
      const opts = order.map((r, i) => {
        const all = finishOptions(r, [...init, ...order.slice(0, i)])
        const top = all.slice(0, 6)
        const bench = all.find((f) => f.key === 'bench')
        return bench && !top.includes(bench) ? [...top, bench] : top
      })
      for (const multi of multimod ? [false, true] : [false]) {
        const slots = multi ? 2 - Math.min(1, craftedTargets.length) : craftedTargets.length ? 0 : 1
        const pick: number[] = []
        const walk = (i: number, used: number, finalBench: boolean, acc: number, mech: string[] = pr.mechanics) => {
          if (best && acc >= best.cost) return
          if (i === order.length) {
            let total = acc
            let pMulti = 0
            if (multi) {
              const benchIdx = pick.map((o, j) => (opts[j][o].key === 'bench' ? j : -1)).filter((j) => j >= 0)
              if (benchIdx.length + craftedTargets.length < 2) return
              pMulti = 1 - benchIdx.reduce((a, j) => a * (1 - needs[j]), 1)
              total += multiCost * pMulti
            }
            if (!best || total < best.cost) best = { order, opts, pick: [...pick], cost: total, multi, pMulti, needs }
            return
          }
          opts[i].forEach((f, o) => {
            const isFinal = f.key === 'bench'
            if (isFinal && used >= slots) return
            // временный крафт после финального мода верстака невозможен без мультимода
            if (!isFinal && f.usesCraft && finalBench && !multi) return
            const nextMech = [...mech, ...f.mechanics]
            if (!mechOk(nextMech)) return
            pick.push(o)
            walk(i + 1, used + (isFinal ? 1 : 0), finalBench || isFinal, acc + f.chaos * needs[i], nextMech)
            pick.pop()
          })
        }
        walk(0, 0, craftedTargets.length > 0, 0)
      }
    }
    const set: FinishSet = { steps: [], weighted: [], mech: new Set() }
    if (!best) return set
    const b = best as Best
    const benchSlots = b.multi ? 2 - Math.min(1, craftedTargets.length) : craftedTargets.length ? 0 : 1
    const benchUsed = b.pick.filter((o, j) => b.opts[j][o].key === 'bench').length
    if (b.multi && multimod) {
      const cs = multimod.cost.map((c) => cost(c.name, c.count))
      set.mech.add('Bench')
      set.weighted.push({ cs, k: b.pMulti })
      set.steps.push({ kind: 'bench', method: 'Bench', optional: true,
        title: T('Если с верстака нужно больше одного мода: мета-крафт «Can have up to 3 Crafted Modifiers»', 'If more than one bench mod is needed: meta-craft "Can have up to 3 Crafted Modifiers"'),
        lines: [T('Мультимод разрешает до трёх модов с верстака (включая сам мультимод).', 'Multimod allows up to three bench mods (including itself).'),
          d.mods.get(multimod.modId)?.gen === 'prefix'
            ? T('Ставится перед модами с верстака; занимает слот префикса.', 'Craft it before the bench mods; it takes a prefix slot.')
            : T('Ставится перед модами с верстака; занимает слот суффикса.', 'Craft it before the bench mods; it takes a suffix slot.'),
          T(`Понадобится с вероятностью ≈ ${pct(b.pMulti)}.`, `Needed with ≈ ${pct(b.pMulti)} probability.`)],
        currency: cs, station: BENCH, farm: farm('Divine Orb') })
    }
    b.order.forEach((r, j) => {
      const f = b.opts[j][b.pick[j]]
      const present = [...init, ...b.order.slice(0, j)]
      f.mechanics.forEach((m) => set.mech.add(m))
      f.steps.forEach((s, i) => {
        set.weighted.push({ cs: s.currency, k: b.needs[j], extra: i === 0 ? extraChaos(f) : 0 })
        set.steps.push({ ...withNeed(s, b.needs[j], altLine(r, present, f, f.key === 'bench' || benchUsed < benchSlots)), lossChaos: i === 0 ? extraChaos(f) : 0 })
      })
    })
    return set
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
        steps.push({ kind: 'explicit', method: 'Influence', title: T(`${ex}: добавить влияние ${inf.name}`, `${ex}: add ${inf.name} influence`),
          lines: [T('Предмет должен быть без влияния и со свободным слотом.', 'The item must be non-influenced with a free slot.'),
            T(`Добавит случайный мод ${inf.name}; нужный ≈ ${pct(infShare(sorted[0]))}:`, `Adds a random ${inf.name} mod; the wanted one ≈ ${pct(infShare(sorted[0]))}:`), ...modLines([sorted[0]]),
            T('Повторить влиянный Exalted на том же предмете нельзя — дальше моды влияния добавляет зверь.', 'It cannot be repeated on the same item; further influence mods come from the beastcraft.')],
          currency: cs, station: INV, farm: farm(ex) })
      }
      for (const r of sorted) {
        if (skipFirst.has(r)) continue
        const p = infShare(r)
        const cs = [costA(inf.beast, 1 / p), costA('Craicic Maw', 1 / p), costA('Orb of Annulment', 1 / p - 1)]
        total += sum(cs)
        steps.push({ kind: 'explicit', method: 'Beastcraft', optional: true,
          title: T(`Если «${label(r)}» не выпал: бист-крафт «Add a Mod to a ${inf.name} Item» (${inf.beast} + Craicic Maw)`, `If "${label(r)}" is missing: beastcraft "Add a Mod to a ${inf.name} Item" (${inf.beast} + Craicic Maw)`),
          lines: [T(`Шанс ≈ ${pct(p)}.`, `≈ ${pct(p)}.`), T('Промах — Orb of Annulment (может снять нужный мод).', 'On a miss use Orb of Annulment (may remove a wanted mod).'), BEAST_SRC],
          currency: cs, station: MENAGERIE, farm: BEAST_FARM })
      }
    }
    return { steps, chaos: total }
  }

  // ---------- базовые значения: даст ли база в этом диапазоне ilvl защиту/урон образца ----------
  // Считаем максимум с выбранными модами (лучший тир, доступный до lvlCap, с учётом магнитуд) и 20% качества.
  type Reach = { ar: number; ev: number; es: number; pdps: number; edps: number }
  const reachAt = (lvlCap: number): Reach => {
    const seen = new Set<string>()
    const lines: { text: string; max: number[] }[] = []
    for (const r of [...explicit, ...fractured, ...craftedTargets]) {
      if (!r.mod) continue
      const m = r.source === 'bench' ? r.mod
        : pool.filter((x) => x.type === r.mod!.type && x.gen === r.mod!.gen && x.reqLevel <= lvlCap).sort((x, y) => y.reqLevel - x.reqLevel)[0] ?? r.mod
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const k = r.source === 'bench' ? 1 : 1 + magOf(m) / 100
      m.text.split('\n').forEach((t, i) => lines.push({ text: t, max: (m.lines[i]?.ranges ?? []).map(([x, y]) => Math.floor(Math.max(x, y) * k)) }))
    }
    // имплиситы предмета (эльдрич, порча, база) с бонусами к защите/урону — берём их значения как есть
    for (const r of resolved.filter((x) => x.kind === 'implicit' || x.kind === 'enchant')) {
      const nums = [...r.text.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0]))
      lines.push({ text: r.text.replace(/\d+(?:\.\d+)?/g, '#'), max: nums })
    }
    const q = 0.2
    const bp = base.props
    const def = (prop: string, flatRe: RegExp, incRe: RegExp) => {
      const v = bp[prop]?.max
      if (!v) return 0
      const flat = lines.filter((l) => flatRe.test(l.text)).reduce((x, l) => x + (l.max[0] ?? 0), 0)
      const inc = lines.filter((l) => /% increased/.test(l.text) && incRe.test(l.text)).reduce((x, l) => x + (l.max[0] ?? 0), 0)
      return Math.round((v + flat) * (1 + inc / 100 + q))
    }
    let pdps = 0
    let edps = 0
    if (bp.physical_damage_max && bp.attack_time) {
      const flatPhys = lines.filter((l) => /^Adds .* Physical Damage$/.test(l.text))
      const fMin = flatPhys.reduce((x, l) => x + (l.max[0] ?? 0), 0)
      const fMax = flatPhys.reduce((x, l) => x + (l.max[1] ?? 0), 0)
      const inc = lines.filter((l) => /increased Physical Damage$/.test(l.text)).reduce((x, l) => x + (l.max[0] ?? 0), 0)
      const as = lines.filter((l) => /increased Attack Speed$/.test(l.text)).reduce((x, l) => x + (l.max[0] ?? 0), 0)
      const aps = (1000 / bp.attack_time) * (1 + as / 100)
      pdps = Math.round(((bp.physical_damage_min + fMin + bp.physical_damage_max + fMax) / 2) * (1 + inc / 100 + q) * aps)
      const ele = lines.filter((l) => /^Adds .* (Fire|Cold|Lightning) Damage$/.test(l.text)).reduce((x, l) => x + ((l.max[0] ?? 0) + (l.max[1] ?? 0)) / 2, 0)
      edps = Math.round(ele * aps)
    }
    return {
      ar: def('armour', /^\+.* to Armour$/, /increased Armour(?!.*Rating)/),
      ev: def('evasion', /^\+.* to Evasion Rating$/, /increased (Armour and |Armour, )?Evasion/),
      es: def('energy_shield', /^\+.* to maximum Energy Shield$/, /increased .*Energy Shield/),
      pdps, edps
    }
  }
  const defenceCheck = (): StepLine[] => {
    const sample: Partial<Reach> = { ...item.props.defence, pdps: item.props.weapon?.pdps, edps: item.props.weapon?.edps }
    const names: Record<keyof Reach, [string, string]> = { ar: ['брони', 'Armour'], ev: ['уклонения', 'Evasion'], es: ['энергощита', 'Energy Shield'], pdps: ['pDPS', 'pDPS'], edps: ['eDPS', 'eDPS'] }
    const capped = reachAt(ilvlMax ?? 100)
    const free = reachAt(100)
    const ok = (v: number, max: number) => v <= max * 1.02
    const out: StepLine[] = []
    for (const k of Object.keys(names) as (keyof Reach)[]) {
      const v = sample[k]
      if (!v || !free[k]) continue
      if (ok(v, capped[k])) continue
      const [ru, en] = names[k]
      if (v <= free[k] * 1.15 && !ok(v, free[k]) && ok(v, capped[k] * 1.15 / 1.02)) continue
      if (ok(v, free[k])) {
        // значение образца достижимо, но только с более высоким ilvl базы
        const lvl = levels.find((L) => L > (ilvlMax ?? 100) && ok(v, reachAt(L)[k])) ?? 100
        out.push(T(`У образца ${v} ${ru}; в диапазоне ilvl ${ilvlRange} выбранные моды дают до ~${capped[k]}. Столько же — с базой ilvl ${lvl}+ («Не учитывать ilvl»).`,
          `The sample has ${v} ${en}; in the ilvl ${ilvlRange} range the selected mods reach ~${capped[k]}. It takes a base of ilvl ${lvl}+ ("Disregard ilvl").`))
      } else
        if (v <= free[k] * 1.15) continue // ~10% расхождения дают ролл базы и скрытые источники — не шумим
        out.push(T(`У образца ${v} ${ru}, а лучшие тиры выбранных модов дают максимум ~${free[k]} (с 20% качества): отметьте в цели ещё моды на ${k === 'pdps' || k === 'edps' ? 'урон' : 'защиту'}.`,
          `The sample has ${v} ${en}, but the best tiers of the selected mods reach only ~${free[k]} (with 20% quality): add more ${k === 'pdps' || k === 'edps' ? 'damage' : 'defence'} mods to the target.`))
    }
    return out
  }

  // ---------- общий хвост: база, fractured, крафт с предмета, имплиситы, финиш ----------
  // цена белой базы в диапазоне ilvl с трейда (медиана 5 самых дешёвых)
  let bp: { chaos: number; count: number } | null = null
  let bpError = false
  if (opts.basePrice) {
    try {
      bp = await opts.basePrice(base.name, craftIlvl, ilvlMax)
    } catch {
      bpError = true
    }
  }
  const baseWarn = finish ? [] : defenceCheck()
  const baseCost: CraftCost[] = bp ? [{ name: T(`${base.name}, ilvl ${ilvlRange} (трейд)`, `${base.name}, ilvl ${ilvlRange} (trade)`), count: '×1', chaos: bp.chaos }] : []
  const head: CraftStep[] = finish ? [] : [{
    kind: 'base', method: 'Base',
    title: T(`База: ${base.name}, ilvl ${ilvlRange}`, `Base: ${base.name}, ilvl ${ilvlRange}`),
    lines: [
      fractured.length
        ? T(`Нужна база с fractured-модом ${names(fractured)} — ищите на трейде или используйте Fracturing Orb.`, `You need a base with fractured ${names(fractured)}: buy one or use a Fracturing Orb.`)
        : T('Белая база в этом диапазоне ilvl.', 'A white base in this ilvl range.'),
      ...(explicit.length
        ? [ilvlMax != null && ilvlMax < 100
          ? T(`Выше ilvl ${ilvlMax} открываются тиры ненужных модов — они разбавят пул и удорожат крафт.`, `Above ilvl ${ilvlMax} tiers of unwanted mods unlock: they dilute the pool and raise the cost.`)
          : T('Чем выше ilvl, тем больше доступно высоких тиров нужных модов.', 'Higher ilvl unlocks higher tiers of the wanted mods.')]
        : []),
      bp ? T(`Цена — медиана ${bp.count} самых дешёвых белых баз на трейде.`, `Price: median of the ${bp.count} cheapest white bases on trade.`)
        : bpError ? T('Цену базы получить не удалось (трейд недоступен) — она не входит в итог.', 'Could not get the base price (trade unavailable); it is not included.')
          : T('Белых баз этого уровня на трейде нет — цена не входит в итог.', 'No white bases of this level on trade; price not included.'),
      ...baseWarn.map((w) => (typeof w === 'string' ? { warn: w } : w))
    ],
    currency: [...baseCost, ...(fractured.length ? [cost('Fracturing Orb', 1)] : [])],
    station: T('Трейд или дроп', 'Trade or drops'), farm: stage
  }]
  const tail: CraftStep[] = []
  for (const r of finish ? craftedTargets.filter((x) => x.added) : craftedTargets.slice(0, 1)) {
    const b = r.bench!
    tail.push({ kind: 'bench', method: 'Bench', title: T(`Верстак: «${d.mods.get(b.modId)?.text.replace(/\n/g, ' / ') ?? r.text}»`, `Crafting bench: "${d.mods.get(b.modId)?.text.replace(/\n/g, ' / ') ?? r.text}"`),
      lines: [T('Последним шагом крафта.', 'The last crafting step.'), T('Без мультимода на предмете может быть только один мод с верстака.', 'Without multimod an item holds only one bench craft.')],
      currency: b.cost.map((c) => cost(c.name, c.count)), station: BENCH, farm: farm(b.cost[0]?.name ?? '') })
  }
  for (const r of resolved.filter((x) => x.source === 'exarch' || x.source === 'eater')) {
    const eldPool = [...d.mods.values()].filter((x) => x.gen === r.mod!.gen && weightFor(x, tags) > 0)
    const Wd = eldPool.reduce((a, x) => a + weightFor(x, tags), 0)
    const w = eldPool.filter((x) => x.type === r.mod!.type).reduce((a, x) => a + weightFor(x, tags), 0)
    const tierName = ELDRITCH_TIERS.includes(r.tier ?? '') ? r.tier! : 'Grand'
    const cur = `${tierName} Eldritch ${r.source === 'exarch' ? 'Ember' : 'Ichor'}`
    tail.push({ kind: 'implicit', method: 'Eldritch',
      title: T(`Имплисит ${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'}: «${r.text}»`, `${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'} implicit: "${r.text}"`),
      lines: [T(`Применять ${cur}, пока не выпадет нужный мод (шанс ≈ ${pct(w / Math.max(1, Wd))}).`, `Apply ${cur} until the mod appears (≈ ${pct(w / Math.max(1, Wd))}).`),
        T('Явные моды не меняются.', 'Explicit mods stay.'), T('Тир имплисита зависит от тира валюты.', 'Implicit tier follows the currency tier.')],
      currency: [costA(cur, Wd / Math.max(1, w))], station: INV, farm: farm(cur) })
  }
  for (const r of resolved.filter((x) => x.source === 'enchant'))
    tail.push({ kind: 'implicit', method: 'Labyrinth', title: T(`Энчант: «${r.text}»`, `Enchant: "${r.text}"`),
      lines: [T('Энчанты шлемов, ботинок и перчаток — Лабиринт.', 'Helmet/boots/gloves enchants come from the Labyrinth.'), T('Часть энчантов даёт Harvest.', 'Some come from Harvest.')],
      currency: [], station: T('Лабиринт', 'Labyrinth'), farm: T('Лабиринт (Eternal для высших энчантов)', 'Labyrinth (Eternal for top enchants)') })
  if (item.props.quality && item.props.quality > 0) {
    const cur = item.props.weapon ? "Blacksmith's Whetstone" : item.props.defence ? "Armourer's Scrap" : null
    tail.push({ kind: 'finish', method: 'Currency', title: T(`Качество ${item.props.quality}%`, `Quality ${item.props.quality}%`),
      lines: cur ? undefined : [T('Для бижутерии — катализаторы под нужные моды.', 'Jewellery: catalysts for the right mod tags.'), T('Для флаконов — Glassblower\'s Bauble.', 'Flasks: Glassblower\'s Bauble.')],
      currency: cur ? [cost(cur, 8, '×4–20')] : [], station: INV, farm: farm(cur ?? '') })
  }
  const links = item.props.sockets?.links ?? 0
  if (links >= 5) {
    // верстак (Orb of Fusing) или бист-крафт «Maximum Possible Links» — что дешевле
    const fusing = [cost('Orb of Fusing', links >= 6 ? 1500 : 150)]
    const morrigan = prices.has('The Black Mórrígan') ? 'The Black Mórrígan' : prices.has('The Black Mórrigan') ? 'The Black Mórrigan' : null
    const beastCs = morrigan && prices.has('Craicic Sand Spitter') ? [cost('Craicic Sand Spitter', 1), cost(morrigan, 1)] : null
    if (beastCs && sum(beastCs) < sum(fusing))
      tail.push({ kind: 'finish', method: 'Beastcraft', title: T('Связать гнёзда: бист-крафт «Maximum Possible Links»', 'Link sockets: beastcraft "Maximum Possible Links"'),
        lines: [T(`Дешевле, чем ${links >= 6 ? 1500 : 150} Orb of Fusing на верстаке.`, `Cheaper than ${links >= 6 ? 1500 : 150} Orbs of Fusing at the bench.`), BEAST_SRC],
        currency: beastCs, station: MENAGERIE, farm: T('The Black Mórrígan — редко в картах T14+', 'The Black Mórrígan: rare in T14+ maps') })
    else
      tail.push({ kind: 'finish', method: 'Bench', title: T(`Связать ${links} гнёзд`, `Link ${links} sockets`), currency: fusing, station: BENCH, farm: farm('Orb of Fusing') })
  }
  for (const r of resolved.filter((x) => x.source === 'corrupted')) {
    const cp = [...d.mods.values()].filter((x) => x.gen === 'corrupted' && weightFor(x, tags) > 0)
    const Wc = cp.reduce((a, x) => a + weightFor(x, tags), 0)
    const tries = 4 * (Wc / Math.max(1, weightFor(r.mod!, tags)))
    tail.push({ kind: 'finish', method: 'Vaal', title: T(`Порча Vaal Orb: «${r.text}»`, `Vaal Orb corruption: "${r.text}"`),
      lines: [T('Необратимо и всегда последним шагом.', 'Irreversible and always last.'), T('Каждая попытка требует новой копии предмета.', 'Every attempt needs a new copy of the item.'),
        T(`Нужный исход ≈ 1 из ${Math.round(tries)}.`, `About 1 in ${Math.round(tries)}.`)],
      currency: [costA('Vaal Orb', tries)], station: INV, farm: farm('Vaal Orb') })
  }
  // докрафт: имплиситы, качество, связи и порча уже на предмете — остаются только новые моды верстака
  if (finish) tail.splice(0, tail.length, ...tail.filter((x) => x.kind === 'bench'))
  const tailMech = [...new Set(tail.flatMap((s) => (s.method === 'Eldritch' ? ['Eldritch'] : s.method === 'Bench' ? ['Bench'] : [])))]

  // ---------- собираем варианты ----------
  /** доля «попыток» в сумме: для неё диапазон 50–100% */
  const split = (cs: CraftCost[], k = 1) => ({
    a: cs.filter((c) => c.attempts).reduce((s, c) => s + (c.chaos ?? 0), 0) * k,
    f: cs.filter((c) => !c.attempts).reduce((s, c) => s + (c.chaos ?? 0), 0) * k
  })
  // источники цифр и альтернативы в описания шагов не выводим — только метод, шансы и риск промаха
  const NOISE = /^(Альтернативы|Alternatives)|Цена — медиана|Price: median|Стоимость посчитана до|Cost counts until|Если выпал почти нужный набор|If you got a near-complete set|Рецепт сверен|Recipe checked|Цену мета-мода берём|The meta mod cost comes|^Стоимость Harvest —|^Harvest costs from/
  const cleanLines = (ls?: StepLine[]) => ls?.filter((l) => typeof l !== 'string' || !NOISE.test(l))
  const noMiss = (cs: CraftCost[]) => cs.filter((c) => !c.miss)
  /** стоимость шага: без промахов и с ними (попытки — 50–100%) */
  const stepCosts = (s: CraftStep): CraftStep => {
    const x = split(noMiss(s.currency)), y = split(s.currency)
    const loss = s.lossChaos ?? 0
    return { ...s, lines: cleanLines(s.lines), cost: [x.f + x.a / 2, x.f + x.a], costMiss: [y.f + (y.a + loss) / 2, y.f + y.a + loss] }
  }
  const parts = (body: CraftStep[], weighted: { cs: CraftCost[]; k: number; extra?: number }[]) => {
    let a = 0, f = 0, ma = 0, mf = 0
    for (const w of weighted) {
      const s = split(noMiss(w.cs), w.k), m = split(w.cs, w.k)
      a += s.a
      f += s.f
      ma += m.a + (w.extra ?? 0) * w.k
      mf += m.f
    }
    for (const s of [...head, ...tail]) {
      const x = split(s.currency)
      a += x.a
      f += x.f
      ma += x.a
      mf += x.f
    }
    return { steps: [...head, ...body, ...tail].map(stepCosts), totalChaos: a + f, costMin: f + a / 2, costMax: a + f, costMissMin: mf + ma / 2, costMissMax: mf + ma }
  }
  const out: (CraftVariant & { key: string })[] = []
  const withTail = (m: Iterable<string>) => [...new Set([...m, ...tailMech])]

  if (!finish && !explicit.length && !infGroups.length) out.push({ key: 'tail', name: T('Имплиситы и финиш', 'Implicits and finish'), mechanics: tailMech, notes: [], ...parts([], []) })
  if (infGroups.length >= 2 && !finish)
    warnings.push(T(`На предмете моды двух влияний (${infGroups.map((g) => g[0].inf!.name).join(' + ')}) — собрать их можно только через Awakener's Orb, поэтому другие варианты не показаны.`,
      `The item has mods of two influences (${infGroups.map((g) => g[0].inf!.name).join(' + ')}); only Awakener's Orb combines them, so other options are hidden.`))
  if (!finish && !explicit.length && infGroups.length === 1) {
    const inf = influenceSteps(new Set(), infGroups.slice(0, 1))
    out.push({ key: 'influence', name: T('Влияние + бист-крафт', 'Influence + beastcraft'), mechanics: withTail(['Influence', 'Beastcraft']), notes: [],
      ...parts(inf.steps, inf.steps.map((s) => ({ cs: s.currency, k: 1 }))) })
  }
  /**
   * Докрафт: как снять моды без галочки. Снять конкретный мод валютой нельзя — считаем ожидаемые затраты:
   * Annulment бьёт случайный мод (k ненужных из N): в среднем k(N+1)/(k+1) сфер и n·k/(k+1) снятых нужных модов;
   * Eldritch Annulment — то же внутри одной стороны; мета-мод на другую сторону + Scouring снимает всю сторону целиком
   * (оставляемые моды этой стороны тогда доводятся заново). Моды верстака снимаются верстаком.
   */
  function finishPrimaries(): Primary[] {
    const keptIdx = new Set(targetIdx)
    const gone = item.mods
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => !keptIdx.has(idx) && (m.kind === 'explicit' || m.kind === 'crafted'))
    const goneCrafted = gone.filter((g) => g.m.kind === 'crafted')
    // явные снимаемые моды — по модам игры (строки гибрида — один мод)
    const goneMods = new Map<string, Side>()
    for (const g of gone.filter((x) => x.m.kind === 'explicit')) {
      const mod = pool.filter((x) => (!g.m.gen || x.gen === g.m.gen) && fits(x, g.m.text)).sort((a, b) => b.reqLevel - a.reqLevel)[0]
      goneMods.set(mod?.id ?? 'line' + g.idx, ((mod?.gen ?? g.m.gen) as Side) ?? 'prefix')
    }
    const keptReal = explicit.filter((r) => r.kept)
    const already = (lostSide?: Side) => (r: Resolved) => (r.added || (lostSide && r.kept && r.gen === lostSide) ? 0 : 1)
    const NONE = undefined as unknown as Resolved
    const benchRemove: CraftStep[] = goneCrafted.length
      ? [{ kind: 'bench', method: 'Bench', title: T('Верстак: снять моды с верстака («Remove Crafted Modifiers»)', 'Bench: remove crafted modifiers'),
        lines: [T('Снимает все моды с верстака, остальные не трогает.', 'Removes all bench crafts; other mods stay.')], currency: [cost('Orb of Scouring', 1)], station: BENCH, farm: farm('Orb of Scouring') }]
      : []
    const k = goneMods.size
    const out: Primary[] = []
    const name = (x: string) => T(`Докрафт: ${x}`, `Finish: ${x}`)
    if (!k) {
      out.push({ key: 'finish', name: T('Докрафт', 'Finish'), mechanics: benchRemove.length ? ['Bench'] : [], steps: benchRemove, chaos: sum(benchRemove.flatMap((x) => x.currency)), main: NONE, notes: [], already: already() })
      return out
    }
    const goneLines = gone.filter((g) => g.m.kind === 'explicit').map((g) => ({ mod: g.m.text, gen: g.m.gen }) as StepLine)
    // а) Orb of Annulment
    {
      const n = keptReal.length
      const N = k + n
      const annuls = (k * (N + 1)) / (k + 1)
      const lost = (n * k) / (k + 1)
      const loss = lost * avgRefin(keptReal)
      const step: CraftStep = { kind: 'explicit', method: 'Currency', title: T('Orb of Annulment, пока не уйдут ненужные моды', 'Orb of Annulment until the unwanted mods are gone'),
        lines: [T('Снять:', 'Remove:'), ...goneLines, T(`Первая сфера попадёт в ненужный мод с шансом ≈ ${pct(k / N)}.`, `The first orb hits an unwanted mod ≈ ${pct(k / N)} of the time.`),
          ...(n ? [T(`Промах снимает нужный мод (в среднем ~${fmtN(lost)}) — его повторная доводка ~${fmtC(loss)}.`, `A miss removes a wanted mod (~${fmtN(lost)} on average); re-finishing it ~${fmtC(loss)}.`)] : [])],
        currency: [costA('Orb of Annulment', annuls)], station: INV, farm: farm('Orb of Annulment'), lossChaos: loss }
      out.push({ key: 'finish-annul', name: name('Orb of Annulment'), mechanics: ['Currency', ...(benchRemove.length ? ['Bench'] : [])], steps: [...benchRemove, step],
        chaos: sum([...benchRemove, step].flatMap((x) => x.currency)) + loss, main: NONE, notes: [], already: already() })
    }
    // б) Eldritch Orb of Annulment: снимает мод только доминирующей стороны
    if (ELDRITCH_CLASSES.has(base.itemClass) && prices.has('Eldritch Orb of Annulment')) {
      const steps: CraftStep[] = [...benchRemove]
      let loss = 0
      for (const side of ['prefix', 'suffix'] as Side[]) {
        const ks = [...goneMods.values()].filter((g) => g === side).length
        if (!ks) continue
        const keptSide = keptReal.filter((r) => r.gen === side)
        const N = ks + keptSide.length
        const annuls = (ks * (N + 1)) / (ks + 1)
        const lost = (keptSide.length * ks) / (ks + 1)
        const l = lost * avgRefin(keptSide)
        loss += l
        const dom = side === 'prefix' ? 'Searing Exarch' : 'Eater of Worlds'
        const setup = side === 'prefix' ? 'Lesser Eldritch Ember' : 'Lesser Eldritch Ichor'
        steps.push({ kind: 'explicit', method: 'Eldritch', title: T(`Eldritch Orb of Annulment при доминировании ${dom}`, `Eldritch Orb of Annulment with ${dom} dominance`),
          lines: [T(`Снимает только ${side === 'prefix' ? 'префиксы' : 'суффиксы'}: другая сторона в безопасности.`, `Removes only ${side}es: the other side is safe.`),
            T(`Доминирование ${dom} — его имплисит выше тиром; если имплиситов нет — ${setup}.`, `${dom} dominance: its implicit has the higher tier; without implicits use ${setup}.`),
            T(`Первая сфера попадёт в ненужный мод с шансом ≈ ${pct(ks / N)}.`, `The first orb hits an unwanted mod ≈ ${pct(ks / N)} of the time.`),
            ...(keptSide.length ? [T(`Промах снимает нужный мод этой стороны — повторная доводка ~${fmtC(l)}.`, `A miss removes a wanted mod on this side; re-finishing ~${fmtC(l)}.`)] : [])],
          currency: [cost(setup, 1), costA('Eldritch Orb of Annulment', annuls)], station: INV, farm: farm('Eldritch'), lossChaos: l })
      }
      out.push({ key: 'finish-eldritch', name: name('Eldritch Annulment'), mechanics: ['Eldritch', ...(benchRemove.length ? ['Bench'] : [])], steps,
        chaos: sum(steps.flatMap((x) => x.currency)) + loss, main: NONE, notes: [], already: already() })
    }
    // в) все снимаемые моды на одной стороне: закрепить другую сторону мета-модом и снять эту Orb of Scouring
    const sides = new Set(goneMods.values())
    if (sides.size === 1) {
      const side = [...sides][0]
      const other: Side = side === 'prefix' ? 'suffix' : 'prefix'
      const meta = metaFor(other)
      if (meta) {
        const keptSide = keptReal.filter((r) => r.gen === side)
        const cs = [...meta.cost.map((c) => cost(c.name, c.count)), cost('Orb of Scouring', 1)]
        const step: CraftStep = { kind: 'bench', method: 'Meta-craft', title: T(`Мета-крафт «${d.mods.get(meta.modId)?.text}» → Orb of Scouring`, `Meta-craft "${d.mods.get(meta.modId)?.text}" → Orb of Scouring`),
          lines: [T(`${other === 'prefix' ? 'Префиксы' : 'Суффиксы'} закреплены, Scouring снимает все ${side === 'prefix' ? 'префиксы' : 'суффиксы'} — без промахов.`, `${other === 'prefix' ? 'Prefixes' : 'Suffixes'} are locked; Scouring removes every ${side} — no misses.`),
            ...(keptSide.length ? [T('Оставляемые моды этой стороны тоже уйдут — они ниже в доводке:', 'Kept mods on this side go too; they are re-added below:'), ...modLines(keptSide)] : [])],
          currency: cs, station: BENCH, farm: farm('Divine Orb') }
        out.push({ key: 'finish-lock', name: name(T('закрепить сторону + Scouring', 'lock a side + Scouring')), mechanics: ['Meta-craft', ...(benchRemove.length ? ['Bench'] : [])],
          steps: [...benchRemove, step], chaos: sum([...benchRemove, step].flatMap((x) => x.currency)), main: NONE, notes: [], already: already(side) })
      }
    }
    return out
  }

  // кандидатов основного метода много (разные точки остановки): по быстрой оценке доводки оставляем по два на метод
  const fsCost = (fs: FinishSet) => fs.weighted.reduce((a, w) => a + (sum(w.cs) + (w.extra ?? 0)) * w.k, 0)
  if (finish) primaries.push(...finishPrimaries())
  const shortlist: Primary[] = []
  {
    const byKey = new Map<string, { pr: Primary; c: number }[]>()
    for (const pr of primaries) {
      const list = byKey.get(pr.key) ?? []
      list.push({ pr, c: pr.chaos + fsCost(finishSingle(pr)) })
      byKey.set(pr.key, list)
    }
    for (const list of byKey.values()) shortlist.push(...list.sort((a, b) => a.c - b.c).slice(0, 2).map((x) => x.pr))
  }
  for (const pr of shortlist) {
    // с двумя влияниями без Awakener предмет не собрать — такой вариант был бы неполным
    if (infGroups.length >= 2 && pr.key !== 'awakener') continue
    const notes = [...pr.notes]
    // моды влияния: Awakener уже дал по одному моду двух влияний; иначе — только одно влияние
    const groups = pr.key === 'awakener' ? infGroups.slice(0, 2) : infGroups.slice(0, 1)
    const infPart = groups.length && !finish ? influenceSteps(new Set<Resolved>(influenced.filter((r) => pr.already(r) >= 1)), groups) : null
    if (groups.length && pr.key !== 'awakener' && infGroups.length > 1)
      notes.push(T(`Второе влияние (${infGroups[1][0].inf!.name}) этим путём не получить — смотрите вариант с Awakener's Orb.`, `The second influence (${infGroups[1][0].inf!.name}) needs the Awakener's Orb option.`))
    if (pr.chaos > 0 && divine && pr.chaos > 50 * divine)
      notes.push(T('Основной метод уходит в тысячи попыток — такую комбинацию обычно дешевле купить.', 'The main method takes thousands of tries; buying is usually cheaper.'))
    const build = (fs: FinishSet) => {
      const mech = new Set([...pr.mechanics, ...fs.mech])
      const body = [...pr.steps, ...fs.steps]
      const weighted = [...pr.steps.map((s) => ({ cs: s.currency, k: 1, extra: s.lossChaos ?? 0 })), ...fs.weighted]
      if (infPart) {
        body.push(...infPart.steps)
        for (const s of infPart.steps) weighted.push({ cs: s.currency, k: 1 })
        mech.add('Influence')
        if (infPart.steps.some((s) => s.optional)) mech.add('Beastcraft')
      }
      return { mechanics: withTail(mech), ...parts(body, weighted) }
    }
    const joint = build(finishJoint(pr))
    const single = build(finishSingle(pr))
    out.push({ key: pr.key.startsWith('ess-') ? 'essence' : pr.key, name: pr.name, notes, ...joint, single })
  }
  out.sort((a, b) => a.costMissMax - b.costMissMax)
  // по одному варианту на каждый основной метод (лучшая эссенция из всех), не больше восьми
  const seen = new Set<string>()
  const variantsOut: CraftVariant[] = out
    .filter((v) => (seen.has(v.key) ? false : (seen.add(v.key), true)))
    .slice(0, 8)
    .map(({ key: _k, ...v }) => v)

  if (missingPrice.size) warnings.push(T(`Нет цены на poe.ninja: ${[...missingPrice].join(', ')} — итог по ним занижен.`, `No poe.ninja price for: ${[...missingPrice].join(', ')}; totals are understated.`))
  return { stage, ilvl: craftIlvl, ilvlMax, ignoreIlvl: !!opts.ignoreIlvl, targets, variants: variantsOut, divine, warnings, missingPrices: [...missingPrice] }
}
