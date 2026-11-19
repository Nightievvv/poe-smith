import type { CraftCost, CraftPlan, CraftStep, CraftTarget, CraftVariant, Lang, ParsedItem } from '../../shared/types'
import { loadCraftData, matchMod, matchModText, weightFor, type Base, type BenchCraft, type Fossil, type Mod } from './craftdata'
import { getPriceBook } from './ninja'

/**
 * Планировщик крафта. Строит несколько вариантов: основной метод (Currency, Essence, Fossil, Harvest) получает
 * «основной» мод, затем для каждого оставшегося мода — шаг доводки (верстак, Exalted Orb, мета-крафт), который
 * нужен, только если мод не выпал раньше. Стоимость:
 *  - гарантированный метод (эссенция): до «основной мод + один дополнительный»;
 *  - негарантированный (Chaos, Alteration, Fossil, Harvest): только до основного мода;
 *  - доводка: стоимость × вероятность, что мод ещё нужен.
 * Вероятности приближённые (модель «2 случайных мода на сторону» вместо точного выбора без возвращения).
 */

type Source = 'base' | 'exarch' | 'eater' | 'corrupted' | 'enchant' | 'bench' | 'fractured' | 'explicit' | 'unknown'
type Side = 'prefix' | 'suffix'

interface Resolved {
  text: string
  kind: ParsedItem['mods'][number]['kind']
  tier?: string
  gen?: Side
  mod?: Mod
  bench?: BenchCraft
  source: Source
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
const HARVEST_TAGS = ['life', 'defences', 'fire', 'cold', 'lightning', 'chaos', 'physical', 'attack', 'caster', 'speed', 'critical']
/** сколько лайфорса стоит реролл Harvest с тегом — оценка, точное число видно на Horticrafting Station */
const LIFEFORCE_PER_REFORGE = 75
const RESONATORS = ['Primitive Chaotic Resonator', 'Potent Chaotic Resonator', 'Powerful Chaotic Resonator', 'Prime Chaotic Resonator']

function domainOk(mod: Mod, base: Base) {
  if (mod.domain === base.domain) return true
  if (base.itemClass === 'Jewel') return mod.domain === 'jewel'
  if (/Abyss/.test(base.itemClass)) return mod.domain === 'abyss_jewel'
  return false
}

export async function buildPlan(item: ParsedItem, targetIdx: number[], lang: Lang, league: string): Promise<CraftPlan> {
  const T = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const d = await loadCraftData()
  const prices = await getPriceBook(league).catch(() => new Map<string, number>())
  const divine = prices.get('Divine Orb') ?? null
  const warnings: string[] = []
  const missingPrice = new Set<string>()

  const price = (name: string) => {
    const p = prices.get(name)
    if (p == null) missingPrice.add(name)
    return p ?? 0
  }
  const fmtN = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))
  const cost = (name: string, count: number, label?: string): CraftCost => {
    const p = prices.get(name)
    if (p == null) missingPrice.add(name)
    return { name, count: label ?? `×${fmtN(count)}`, chaos: p != null ? p * count : undefined }
  }
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
    return { stage: '', ilvl: item.itemLevel ?? 0, targets: [], variants: [], divine,
      warnings: [T(`База «${item.baseType}» не найдена в данных игры.`, `Base "${item.baseType}" not found in game data.`)] }
  }
  const tags = base.tags
  const ilvl = item.itemLevel ?? 86
  const pool = [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, tags) > 0)
  const benchForClass = d.bench.filter((b) => b.itemClasses.includes(base.itemClass))

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
  const need = Math.max(base.dropLevel, ...[...explicit, ...fractured].map((r) => r.mod!.reqLevel))
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
    unknown: T('не найден в данных игры', 'not found in game data')
  }
  const targets: CraftTarget[] = resolved.map((r) => ({
    text: r.text, kind: r.kind, tier: r.tier ?? (r.mod && (r.source === 'explicit' || r.source === 'fractured') ? tierOf(r.mod) : undefined),
    gen: r.kind === 'implicit' || r.kind === 'enchant' ? 'implicit' : r.gen, found: r.source !== 'unknown', source: SOURCE[r.source]
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

  // самый трудный мод — основной для негарантированных методов
  const hardest = [...explicit].sort((a, b) => share(a) - share(b))[0]

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
      const p = pOn(hardest, 2)
      const tries = 1 / p
      const cs = [cost('Orb of Alchemy', 1), cost('Chaos Orb', tries)]
      primaries.push({
        key: 'chaos', name: T('Chaos Orb', 'Chaos Orb'), mechanics: ['Currency'], main: hardest, chaos: sum(cs), notes: [],
        already: (r) => (r === hardest ? 1 : pOn(r, 2)),
        steps: [{ kind: 'explicit', title: T(`Chaos Orb до «${hardest.text}»`, `Chaos Orb until "${hardest.text}"`),
          detail: [T(`Шанс за попытку ≈ ${pct(p)}. Начните с редкой базы (Orb of Alchemy).`, `≈ ${pct(p)} per try. Start from a rare base (Orb of Alchemy).`), extrasNote(hardest)].filter(Boolean).join(' '),
          currency: cs, station: INV, farm: farm('Chaos Orb') }]
      })
    }

    // Currency: Alteration (магический предмет) + Regal
    {
      const pa = 0.5 * share(hardest)
      const alts = 1 / pa
      const second = explicit.filter((x) => x.mod!.gen !== hardest.mod!.gen).sort((a, b) => share(a) - share(b))[0]
      const cs = [cost('Orb of Transmutation', 1), cost('Orb of Alteration', alts)]
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
        key: 'alt', name: T('Alteration + Regal', 'Alteration + Regal'), mechanics: ['Currency'], main: hardest, notes: [],
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
      const pAdd = rest.length ? 1 - rest.reduce((a, o) => a * (1 - pOn(o, o.mod!.gen === main.mod!.gen ? 1.2 : 1.8)), 1) : 1
      const tries = 1 / Math.max(1e-9, pAdd)
      const cs = [cost(ess.name, tries)]
      primaries.push({
        key: 'ess-' + ess.name, name: T(`Эссенция: ${ess.name}`, `Essence: ${ess.name}`), mechanics: ['Essence'], main, chaos: sum(cs), notes: [],
        already: (r) => (r === main ? 1 : Math.min(1, pOn(r, r.mod!.gen === main.mod!.gen ? 1.2 : 1.8) / pAdd)),
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

    // Harvest: реролл с гарантированным модом нужного тега
    if (base.domain !== 'flask') {
      const lf = ['Wild Crystallised Lifeforce', 'Vivid Crystallised Lifeforce', 'Primal Crystallised Lifeforce'].map((n) => ({ n, p: prices.get(n) })).filter((x) => x.p != null)
      const cheapest = lf.sort((a, b) => a.p! - b.p!)[0]
      const tag = HARVEST_TAGS.find((t) => hardest.mod!.tags.includes(t))
      if (tag && cheapest) {
        const tagW = rollable.filter((x) => x.tags.includes(tag)).reduce((a, x) => a + weightFor(x, tags), 0)
        const pTag = wAtLeast(hardest.mod!) / Math.max(1, tagW)
        const p = Math.max(pTag, pOn(hardest, 2))
        const tries = 1 / p
        const cs = [cost(cheapest.n, tries * LIFEFORCE_PER_REFORGE)]
        primaries.push({
          key: 'harvest', name: T(`Harvest: реролл с модом «${tag}»`, `Harvest: reforge with a ${tag} modifier`), mechanics: ['Harvest'], main: hardest, chaos: sum(cs),
          notes: [T(`Расход лайфорса на реролл — оценка (~${LIFEFORCE_PER_REFORGE}); точное число видно на Horticrafting Station.`, `Lifeforce per reforge is an estimate (~${LIFEFORCE_PER_REFORGE}); check the Horticrafting Station.`)],
          already: (r) => (r === hardest ? 1 : pOn(r, 2)),
          steps: [{ kind: 'explicit', title: T(`Harvest «Reforge … including a ${tag} modifier» до «${hardest.text}»`, `Harvest "Reforge … including a ${tag} modifier" until "${hardest.text}"`),
            detail: [T(`Гарантирует мод с тегом ${tag}; нужный среди них ≈ ${pct(pTag)}.`, `Guarantees a ${tag} mod; the wanted one ≈ ${pct(pTag)}.`), extrasNote(hardest)].filter(Boolean).join(' '),
            currency: cs, station: T('Horticrafting Station в убежище', 'Hideout Horticrafting Station'), farm: farm('Lifeforce') }]
        })
      }
    }

    // Fossil: подбираем 1–2 фоссилии, которые усиливают основной мод и не блокируют нужные
    if (base.domain !== 'flask') {
      const ok = d.fossils.filter((f) => prices.has(f.name) && explicit.every((r) => mult(r.mod!, [f]) > 0))
      const boosting = ok.filter((f) => mult(hardest.mod!, [f]) > 1)
      const combos: Fossil[][] = [...boosting.map((f) => [f])]
      for (const a of boosting) for (const b of ok) if (a !== b && !combos.some((c) => c.length === 2 && c.includes(a) && c.includes(b))) combos.push([a, b])
      const scored = combos.map((fs) => {
        const p = pOn(hardest, 2, fs)
        const per = fs.reduce((a, f) => a + price(f.name), 0) + price(RESONATORS[fs.length - 1])
        return { fs, p, chaos: per / Math.max(1e-9, p) }
      }).sort((a, b) => a.chaos - b.chaos)
      const best = scored[0]
      if (best) {
        const tries = 1 / best.p
        const cs = [...best.fs.map((f) => cost(f.name, tries)), cost(RESONATORS[best.fs.length - 1], tries)]
        primaries.push({
          key: 'fossil', name: T(`Фоссилии: ${best.fs.map((f) => f.name).join(' + ')}`, `Fossils: ${best.fs.map((f) => f.name).join(' + ')}`), mechanics: ['Fossil'],
          main: hardest, chaos: sum(cs), notes: [],
          already: (r) => (r === hardest ? 1 : pOn(r, 2, best.fs)),
          steps: [{ kind: 'explicit', title: T(`${RESONATORS[best.fs.length - 1]} + ${best.fs.map((f) => f.name).join(' + ')} до «${hardest.text}»`,
            `${RESONATORS[best.fs.length - 1]} + ${best.fs.map((f) => f.name).join(' + ')} until "${hardest.text}"`),
            detail: [T(`Шанс за попытку ≈ ${pct(best.p)} (без фоссилий ≈ ${pct(pOn(hardest, 2))}).`, `≈ ${pct(best.p)} per try (without fossils ≈ ${pct(pOn(hardest, 2))}).`), extrasNote(hardest)].filter(Boolean).join(' '),
            currency: cs, station: INV, farm: farm('Fossil') }]
        })
      }
    }
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
      const ex = 1 / p
      const cs = [cost('Exalted Orb', ex), cost('Orb of Annulment', ex - 1)]
      out.push({ chaos: sum(cs), mechanics: ['Currency'], usesCraft: false,
        steps: [{ kind: 'explicit', optional: true, title: title(T('Exalted Orb в свободный слот', 'Exalted Orb into a free slot')),
          detail: T(`Шанс ≈ ${pct(p)}. Промах снимается Orb of Annulment, но он убирает случайный мод — может снять нужный.`,
            `≈ ${pct(p)}. A miss is removed with Orb of Annulment, which removes a random mod and may hit a wanted one.`),
          currency: cs, station: INV, farm: farm('Exalted Orb') }] })
    }
    // мета-крафт: закрепить другую сторону, Scouring, Exalted — безопасно для уже полученных модов
    const lock: Side = r.mod!.gen === 'prefix' ? 'suffix' : 'prefix'
    const meta = metaFor(lock)
    if (meta) {
      const cycle = [...meta.cost.map((c) => cost(c.name, c.count / p)), cost('Orb of Scouring', 1 / p), cost('Exalted Orb', 1 / p)]
      out.push({ chaos: sum(cycle), mechanics: ['Meta-craft'], usesCraft: false,
        steps: [{ kind: 'bench', optional: true, title: title(T(`мета-крафт «${d.mods.get(meta.modId)?.text}» → Orb of Scouring → Exalted Orb`, `meta-craft "${d.mods.get(meta.modId)?.text}" → Orb of Scouring → Exalted Orb`)),
          detail: T(`Закреплённая сторона не меняется, Scouring снимает только другую (и крафтовый мод). Шанс за цикл ≈ ${pct(p)}. Мета-мод занимает слот крафта — после него можно снова ставить мод с верстака.`,
            `The locked side stays; Scouring removes only the other side (and the craft). ≈ ${pct(p)} per cycle. The meta mod uses the craft slot; bench again afterwards.`),
          currency: cycle, station: BENCH, farm: farm('Divine Orb') }] })
    }
    return out.sort((a, b) => a.chaos - b.chaos)
  }

  // ---------- общий хвост: база, fractured, крафт с предмета, имплиситы, финиш ----------
  const head: CraftStep[] = [{
    kind: 'base',
    title: T(`База: ${base.name}, ilvl ${need}+`, `Base: ${base.name}, ilvl ${need}+`),
    detail: fractured.length
      ? T(`Нужна база с fractured-модом ${names(fractured)} — ищите на трейде или используйте Fracturing Orb.`, `You need a base with fractured ${names(fractured)}: buy one or use a Fracturing Orb.`)
      : T('Белая база нужного уровня: чем выше ilvl, тем больше доступно высоких тиров.', 'A white base of the required level: higher ilvl unlocks higher tiers.'),
    currency: fractured.length ? [cost('Fracturing Orb', 1)] : [],
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
      currency: [cost(cur, Wd / Math.max(1, w))], station: INV, farm: farm(cur) })
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
  if (links >= 5)
    tail.push({ kind: 'finish', title: T(`Связать ${links} гнёзд`, `Link ${links} sockets`), currency: [cost('Orb of Fusing', links >= 6 ? 1500 : 150)],
      station: BENCH, farm: farm('Orb of Fusing') })
  for (const r of resolved.filter((x) => x.source === 'corrupted')) {
    const cp = [...d.mods.values()].filter((x) => x.gen === 'corrupted' && weightFor(x, tags) > 0)
    const Wc = cp.reduce((a, x) => a + weightFor(x, tags), 0)
    const tries = 4 * (Wc / Math.max(1, weightFor(r.mod!, tags)))
    tail.push({ kind: 'finish', title: T(`Порча Vaal Orb: «${r.text}»`, `Vaal Orb corruption: "${r.text}"`),
      detail: T(`Необратимо и всегда последним шагом: каждая попытка требует новой копии предмета. Нужный исход ≈ 1 из ${Math.round(tries)}.`, `Irreversible and always last: every attempt needs a new copy of the item. About 1 in ${Math.round(tries)}.`),
      currency: [cost('Vaal Orb', tries)], station: INV, farm: farm('Vaal Orb') })
  }
  const tailChaos = sum([...head, ...tail].flatMap((s) => s.currency))
  const tailMech = [...new Set(tail.flatMap((s) => (s.kind === 'implicit' && /Eldritch/.test(s.currency[0]?.name ?? '') ? ['Eldritch'] : s.kind === 'bench' ? ['Bench'] : [])))]

  // ---------- собираем варианты ----------
  const out: (CraftVariant & { key: string })[] = []
  if (!explicit.length) {
    out.push({ key: 'tail', name: T('Имплиситы и финиш', 'Implicits and finish'), mechanics: tailMech, steps: [...head, ...tail], totalChaos: tailChaos, notes: [] })
  }
  for (const pr of primaries) {
    let craftFree = craftedTargets.length === 0
    const steps: CraftStep[] = [...head, ...pr.steps]
    let total = pr.chaos
    const mech = new Set(pr.mechanics)
    // сначала доводим самые трудные моды — для них выгоднее занять единственный слот крафта
    const rest = explicit.filter((x) => x !== pr.main).sort((a, b) => share(a) - share(b))
    for (const r of rest) {
      const opts = finishOptions(r, craftFree)
      const best = opts[0]
      if (!best) continue
      const needP = 1 - pr.already(r)
      total += best.chaos * needP
      if (best.usesCraft) craftFree = false
      best.mechanics.forEach((m) => mech.add(m))
      steps.push(...best.steps.map((s) => ({ ...s, detail: [s.detail, T(`Понадобится с вероятностью ≈ ${pct(needP)}.`, `Needed with ≈ ${pct(needP)} probability.`)].filter(Boolean).join(' ') })))
    }
    steps.push(...tail)
    tailMech.forEach((m) => mech.add(m))
    total += tailChaos
    const notes = [...pr.notes]
    if (pr.chaos > 0 && divine && pr.chaos > 50 * divine)
      notes.push(T('Основной метод уходит в тысячи попыток — такую комбинацию обычно дешевле купить.', 'The main method takes thousands of tries; buying is usually cheaper.'))
    out.push({ key: pr.key.startsWith('ess-') ? 'essence' : pr.key, name: pr.name, mechanics: [...mech], steps, totalChaos: total, notes })
  }
  out.sort((a, b) => (a.totalChaos ?? Infinity) - (b.totalChaos ?? Infinity))
  // по одному варианту на каждый основной метод (лучшая эссенция из всех), не больше пяти
  const seen = new Set<string>()
  const variantsOut: CraftVariant[] = out
    .filter((v) => (seen.has(v.key) ? false : (seen.add(v.key), true)))
    .slice(0, 5)
    .map(({ key: _k, ...v }) => v)

  if (missingPrice.size) warnings.push(T(`Нет цены на poe.ninja: ${[...missingPrice].join(', ')} — итог по ним занижен.`, `No poe.ninja price for: ${[...missingPrice].join(', ')}; totals are understated.`))
  return { stage, ilvl: need, targets, variants: variantsOut, divine, warnings }
}
