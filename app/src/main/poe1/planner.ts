import type { CraftCost, CraftPlan, CraftStep, CraftTarget, Lang, ParsedItem } from '../../shared/types'
import { loadCraftData, matchMod, matchModText, weightFor, type Base, type BenchCraft, type CraftData, type Mod } from './craftdata'
import { getPriceBook } from './ninja'

/**
 * Гибридный планировщик: методы крафта описаны шаблонами (эссенция, Alteration, Chaos, верстак, эльдрич-валюта, Vaal),
 * а вероятности и стоимость считаются по данным игры (веса модов для конкретной базы) и текущим ценам poe.ninja.
 * Вероятности приближённые: игра выбирает моды без возвращения и с ограничением по группам, здесь — упрощённая модель.
 */

type Source = 'base' | 'exarch' | 'eater' | 'corrupted' | 'enchant' | 'bench' | 'fractured' | 'explicit' | 'unknown'

interface Resolved {
  text: string
  kind: ParsedItem['mods'][number]['kind']
  tier?: string
  gen?: 'prefix' | 'suffix'
  mod?: Mod
  bench?: BenchCraft
  source: Source
}

const ELDRITCH_TIERS = ['Lesser', 'Greater', 'Grand', 'Exceptional', 'Exquisite', 'Perfect']

function domainOk(mod: Mod, base: Base) {
  if (mod.domain === base.domain) return true
  if (base.itemClass === 'Jewel') return mod.domain === 'jewel'
  if (base.itemClass === 'AbyssJewel' || /Abyss/.test(base.itemClass)) return mod.domain === 'abyss_jewel'
  return false
}

export async function buildPlan(item: ParsedItem, targetIdx: number[], lang: Lang, league: string): Promise<CraftPlan> {
  const T = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  const d = await loadCraftData()
  const prices = await getPriceBook(league).catch(() => new Map<string, number>())
  const divine = prices.get('Divine Orb') ?? null
  const warnings: string[] = []
  // из вариантов базы с одним названием выбираем тот, чей имплисит совпадает с имплиситом предмета
  const variants = d.bases.get(item.baseType) ?? []
  const implicitTexts = item.mods.filter((m) => m.kind === 'implicit').map((m) => m.text)
  const base =
    variants.find((b) => b.implicits.length && b.implicits.every((id) => { const bm = d.mods.get(id); return bm && implicitTexts.some((t) => matchModText(bm, t)) })) ??
    variants[0]

  const cost = (name: string, count: number, label?: string): CraftCost => {
    const p = prices.get(name)
    return { name, count: label ?? `×${count < 10 ? Math.round(count * 10) / 10 : Math.round(count)}`, chaos: p != null ? p * count : undefined }
  }
  const farm = (name: string) =>
    /Essence/.test(name) ? T('Механика Essence в картах; 3 одинаковых эссенции → 1 следующего тира у торговца', 'Essence encounters in maps; 3 of a tier → 1 of the next at a vendor')
      : /Eldritch|Ember|Ichor/.test(name) ? T('Алтари Searing Exarch / Eater of Worlds в картах (нужно влияние на Атласе)', 'Searing Exarch / Eater of Worlds altars in maps (Atlas influence)')
        : /Fossil|Resonator/.test(name) ? T('Delve (Азуритовая шахта)', 'Delve (Azurite Mine)')
          : T('Обычный дроп; дешевле купить на бирже валют в убежище', 'Regular drops; cheaper on the Currency Exchange')

  if (!base) {
    return {
      method: T('Нет данных', 'No data'), stage: '', ilvl: item.itemLevel ?? 0, targets: [], steps: [], totalChaos: null, divine,
      warnings: [T(`База «${item.baseType}» не найдена в данных игры.`, `Base "${item.baseType}" not found in game data.`)]
    }
  }

  const ilvl = item.itemLevel ?? 86
  const pool = [...d.mods.values()].filter((m) => (m.gen === 'prefix' || m.gen === 'suffix') && domainOk(m, base) && weightFor(m, base.tags) > 0)
  const benchForClass = d.bench.filter((b) => b.itemClasses.includes(base.itemClass))

  // ---------- сопоставляем выбранные моды с данными игры ----------
  const resolved: Resolved[] = targetIdx.map((i) => {
    const m = item.mods[i]
    const r: Resolved = { text: m.text, kind: m.kind, tier: m.tier, gen: m.gen, source: 'unknown' }
    const lines = [m.text]
    if (m.kind === 'implicit' || m.kind === 'enchant') {
      if (base.implicits.some((id) => { const bm = d.mods.get(id); return bm && matchModText(bm, m.text) })) r.source = 'base'
      else {
        const eld = [...d.mods.values()].find((x) => (x.gen === 'searing_exarch_implicit' || x.gen === 'eater_of_worlds_implicit') && weightFor(x, base.tags) > 0 && matchMod(x, lines))
        if (eld) { r.mod = eld; r.source = eld.gen === 'searing_exarch_implicit' ? 'exarch' : 'eater' }
        else {
          const cor = [...d.mods.values()].find((x) => x.gen === 'corrupted' && weightFor(x, base.tags) > 0 && matchMod(x, lines))
          if (cor) { r.mod = cor; r.source = 'corrupted' }
          else if (m.kind === 'enchant') r.source = 'enchant'
        }
      }
      return r
    }
    if (m.kind === 'crafted') {
      const b = benchForClass.find((bc) => { const bm = d.mods.get(bc.modId); return bm && matchMod(bm, lines) })
      if (b) { r.bench = b; r.mod = d.mods.get(b.modId); r.source = 'bench' }
      return r
    }
    const cands = pool.filter((x) => (!m.gen || x.gen === m.gen) && matchMod(x, lines)).sort((a, b) => b.reqLevel - a.reqLevel)
    const mod = cands.find((x) => x.reqLevel <= ilvl) ?? cands[0]
    if (mod) { r.mod = mod; r.gen = mod.gen as 'prefix' | 'suffix'; r.source = m.kind === 'fractured' ? 'fractured' : 'explicit' }
    return r
  })

  const tierOf = (mod: Mod) => {
    const same = pool.filter((x) => x.type === mod.type && x.gen === mod.gen).sort((a, b) => b.reqLevel - a.reqLevel)
    const i = same.findIndex((x) => x.id === mod.id)
    return i >= 0 ? `${mod.gen === 'suffix' ? 'S' : 'P'}${i + 1}` : undefined
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

  // ---------- вероятности ----------
  const rollable = pool.filter((x) => x.reqLevel <= Math.max(need, ilvl))
  const W = { prefix: 0, suffix: 0 }
  for (const x of rollable) W[x.gen as 'prefix' | 'suffix'] += weightFor(x, base.tags)
  /** вес «этот тир или лучше» */
  const wAtLeast = (m: Mod) => rollable.filter((x) => x.type === m.type && x.gen === m.gen && x.reqLevel >= m.reqLevel).reduce((a, x) => a + weightFor(x, base.tags), 0)
  const pOn = (m: Mod, picks: number) => 1 - Math.pow(1 - wAtLeast(m) / Math.max(1, W[m.gen as 'prefix' | 'suffix']), picks)

  // один мод можно доделать верстаком — только если верстак способен дать нужное значение
  const benchable = (r: Resolved) => benchForClass.find((b) => { const bm = d.mods.get(b.modId); return bm && bm.type === r.mod!.type && matchMod(bm, [r.text]) })
  let benchFinish: { r: Resolved; b: BenchCraft } | null = null
  for (const r of explicit) {
    const b = benchable(r)
    if (b && (!benchFinish || wAtLeast(r.mod!) < wAtLeast(benchFinish.r.mod!))) benchFinish = { r, b }
  }
  const random = explicit.filter((r) => r !== benchFinish?.r)

  interface Method { name: string; steps: CraftStep[]; chaos: number | null; tries: number }
  const methods: Method[] = []
  const priced = (cs: CraftCost[]) => (cs.every((c) => c.chaos != null) ? cs.reduce((a, c) => a + (c.chaos ?? 0), 0) : null)
  const names = (rs: Resolved[]) => rs.map((r) => `«${r.text}»`).join(', ')

  if (random.length) {
    // A. Chaos Orb (или реролл Harvest): все моды случайны
    {
      const p = random.reduce((a, r) => a * pOn(r.mod!, 2), 1)
      const tries = 1 / p
      const cs = [cost('Chaos Orb', tries)]
      methods.push({
        name: T('Chaos Orb (реролл)', 'Chaos Orb spam'), tries, chaos: priced(cs),
        steps: [{ kind: 'explicit', title: T(`Катать Chaos Orb до ${names(random)}`, `Chaos spam until ${names(random)}`),
          detail: T(`Шанс за попытку ≈ ${(p * 100).toPrecision(2)}%. Начните с редкой базы (Orb of Alchemy).`, `Chance per try ≈ ${(p * 100).toPrecision(2)}%. Start from a rare base (Orb of Alchemy).`),
          currency: [cost('Orb of Alchemy', 1), ...cs], station: T('Инвентарь', 'Inventory'), farm: farm('Chaos Orb') }]
      })
    }
    // B. Эссенция гарантирует один из модов
    for (const r of random) {
      const ess = d.essences
        .filter((e) => { const em = d.mods.get(e.mods[base.itemClass]); return em && em.type === r.mod!.type && em.reqLevel >= r.mod!.reqLevel })
        .sort((a, b) => (prices.get(a.name) ?? 1e9) - (prices.get(b.name) ?? 1e9) || a.level - b.level)[0]
      if (!ess) continue
      const others = random.filter((x) => x !== r)
      const p = others.reduce((a, x) => a * pOn(x.mod!, x.mod!.gen === r.mod!.gen ? 1.2 : 1.8), 1)
      const tries = 1 / p
      const cs = [cost(ess.name, tries)]
      methods.push({
        name: T(`Эссенция (${ess.name})`, `Essence (${ess.name})`), tries, chaos: priced(cs),
        steps: [{ kind: 'explicit',
          title: others.length ? T(`Катать ${ess.name}: гарантирует «${r.text}», ждём ${names(others)}`, `Spam ${ess.name}: guarantees "${r.text}", wait for ${names(others)}`)
            : T(`Применить ${ess.name}: гарантирует «${r.text}»`, `Use ${ess.name}: guarantees "${r.text}"`),
          detail: others.length ? T(`Шанс за попытку ≈ ${(p * 100).toPrecision(2)}%. Эссенция работает на белой базе или перекатывает редкую.`, `Chance per try ≈ ${(p * 100).toPrecision(2)}%. Works on a white base or rerolls a rare.`) : undefined,
          currency: cs, station: T('Инвентарь', 'Inventory'), farm: farm(ess.name) }]
      })
    }
    // C. Alteration + Augmentation на два самых редких мода (префикс + суффикс), затем Regal и Exalted на остальные
    const share = (r: Resolved) => wAtLeast(r.mod!) / Math.max(1, W[r.mod!.gen as 'prefix' | 'suffix'])
    const byRarity = [...random].sort((x, y) => share(x) - share(y))
    const a = byRarity[0]
    const b = byRarity.find((x) => x.mod!.gen !== a.mod!.gen)
    const rest = random.filter((x) => x !== a && x !== b)
    if (rest.length <= 2) {
      const pa = 0.5 * share(a)
      const pb = b ? share(b) : 1
      const alts = 1 / (pa * pb)
      const augs = b ? alts * pa : 0
      // Regal и Exalted добавляют по случайному моду: каждый должен попасть в нужный (порядок не важен)
      const pRest = rest.reduce((acc, r) => acc * share(r), 1) * (rest.length === 2 ? 2 : 1)
      const attempts = 1 / Math.min(1, pRest)
      const exalts = Math.max(0, rest.length - 1)
      const altPhase = [cost('Orb of Transmutation', attempts), cost('Orb of Alteration', alts * attempts), ...(b ? [cost('Orb of Augmentation', augs * attempts)] : [])]
      const rarePhase = [cost('Regal Orb', attempts), ...(exalts ? [cost('Exalted Orb', exalts * attempts)] : []), ...(attempts > 1.01 ? [cost('Orb of Scouring', attempts - 1)] : [])]
      const cs = [...altPhase, ...rarePhase]
      methods.push({
        name: T('Alteration + Regal', 'Alteration + Regal'), tries: alts * attempts, chaos: priced(cs),
        steps: [
          { kind: 'explicit', title: T(`Магический предмет: катать Orb of Alteration до «${a.text}»`, `Magic item: Alteration spam until "${a.text}"`),
            detail: b ? T(`Когда выпал — Orb of Augmentation на «${b.text}» (если не попал — продолжаем Alteration).`, `Then Augmentation for "${b.text}" (if it misses, keep altering).`) : undefined,
            currency: altPhase, station: T('Инвентарь', 'Inventory'), farm: farm('Orb of Alteration') },
          { kind: 'explicit',
            title: rest.length
              ? T(`Regal${exalts ? ' + Exalted' : ''}: добавить ${names(rest)}`, `Regal${exalts ? ' + Exalted' : ''}: add ${names(rest)}`)
              : T('Regal Orb: сделать редким (+1 случайный мод)', 'Regal Orb: make it rare (+1 random mod)'),
            detail: rest.length
              ? T(`Шанс попасть ≈ ${(Math.min(1, pRest) * 100).toPrecision(2)}%. Если не попали — Orb of Scouring и снова с шага Alteration.`, `Hit chance ≈ ${(Math.min(1, pRest) * 100).toPrecision(2)}%. On a miss: Orb of Scouring and back to Alteration.`)
              : undefined,
            currency: rarePhase, station: T('Инвентарь', 'Inventory'), farm: farm('Regal Orb') }
        ]
      })
    }
  }

  const best = methods.sort((x, y) => (x.chaos ?? x.tries * 1e6) - (y.chaos ?? y.tries * 1e6))[0]
  const steps: CraftStep[] = []

  // 1. база
  steps.push({
    kind: 'base',
    title: T(`База: ${base.name}, ilvl ${need}+`, `Base: ${base.name}, ilvl ${need}+`),
    detail: fractured.length
      ? T(`Нужна база с fractured-модом ${names(fractured)} — ищите на трейде или используйте Fracturing Orb на предмете с этим модом.`, `You need a base with fractured ${names(fractured)}: buy one or use a Fracturing Orb.`)
      : T('Белая база нужного уровня: чем выше ilvl, тем больше доступно высоких тиров.', 'A white base of the required level: higher ilvl unlocks higher tiers.'),
    currency: fractured.length ? [cost('Fracturing Orb', 1)] : [],
    station: T('Трейд или дроп', 'Trade or drops'),
    farm: stage
  })
  // 2. явные моды
  if (best) steps.push(...best.steps)
  if (best && (best.tries > 3000 || (best.chaos != null && divine && best.chaos > 50 * divine)))
    warnings.push(T('Такую комбинацию дешевле купить: случайный крафт уходит в тысячи попыток. Для неё нужен мета-крафт (Prefixes/Suffixes Cannot Be Changed, Harvest) — этого метода в плане пока нет.',
      'Cheaper to buy: random crafting takes thousands of tries. It needs meta-crafting (Prefixes/Suffixes Cannot Be Changed, Harvest), which the planner does not cover yet.'))
  // 3. верстак
  const benchSteps = [...(benchFinish ? [{ r: benchFinish.r, b: benchFinish.b }] : []), ...resolved.filter((r) => r.source === 'bench').map((r) => ({ r, b: r.bench! }))]
  for (const { r, b } of benchSteps) {
    const bm = d.mods.get(b.modId)
    steps.push({
      kind: 'bench', title: T(`Верстак: «${bm?.text.replace(/\n/g, ' / ') ?? r.text}»`, `Crafting bench: "${bm?.text.replace(/\n/g, ' / ') ?? r.text}"`),
      detail: T('Нужен свободный слот префикса или суффикса. Крафт верстака можно снять и поставить заново.', 'Needs a free prefix or suffix slot. Bench crafts can be removed and redone.'),
      currency: b.cost.map((c) => cost(c.name, c.count)), station: T('Верстак в убежище (рецепт должен быть открыт)', 'Hideout crafting bench (recipe must be unlocked)'), farm: farm(b.cost[0]?.name ?? '')
    })
  }
  // 4. имплиситы
  for (const r of resolved.filter((x) => x.source === 'exarch' || x.source === 'eater')) {
    const eldPool = [...d.mods.values()].filter((x) => x.gen === r.mod!.gen && weightFor(x, base.tags) > 0)
    const Wd = eldPool.reduce((a, x) => a + weightFor(x, base.tags), 0)
    const w = eldPool.filter((x) => x.type === r.mod!.type).reduce((a, x) => a + weightFor(x, base.tags), 0)
    const tierName = ELDRITCH_TIERS.includes(r.tier ?? '') ? r.tier! : 'Grand'
    const cur = `${tierName} Eldritch ${r.source === 'exarch' ? 'Ember' : 'Ichor'}`
    steps.push({
      kind: 'implicit',
      title: T(`Имплисит ${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'}: «${r.text}»`, `${r.source === 'exarch' ? 'Searing Exarch' : 'Eater of Worlds'} implicit: "${r.text}"`),
      detail: T(`Применять ${cur}, пока не выпадет нужный мод (шанс ≈ ${((w / Math.max(1, Wd)) * 100).toPrecision(2)}%). Явные моды не меняются. Тир имплисита зависит от тира валюты.`,
        `Apply ${cur} until the mod appears (≈ ${((w / Math.max(1, Wd)) * 100).toPrecision(2)}%). Explicit mods stay. Implicit tier depends on the currency tier.`),
      currency: [cost(cur, Wd / Math.max(1, w))], station: T('Инвентарь', 'Inventory'), farm: farm(cur)
    })
  }
  for (const r of resolved.filter((x) => x.source === 'enchant'))
    steps.push({ kind: 'implicit', title: T(`Энчант: «${r.text}»`, `Enchant: "${r.text}"`),
      detail: T('Энчанты шлемов, ботинок и перчаток — Лабиринт; часть энчантов даёт Harvest.', 'Helmet/boots/gloves enchants come from the Labyrinth; some from Harvest.'),
      currency: [], station: T('Лабиринт', 'Labyrinth'), farm: T('Лабиринт (Eternal для высших энчантов)', 'Labyrinth (Eternal for top enchants)') })
  // 5. финиш: качество, связи, порча
  if (item.props.quality && item.props.quality > 0) {
    const isWeapon = !!item.props.weapon
    const isArmour = !!item.props.defence
    const cur = isWeapon ? "Blacksmith's Whetstone" : isArmour ? "Armourer's Scrap" : null
    steps.push({ kind: 'finish', title: T(`Качество ${item.props.quality}%`, `Quality ${item.props.quality}%`),
      detail: cur ? undefined : T('Для бижутерии — катализаторы под нужные моды; для флаконов — Glassblower\'s Bauble.', 'Jewellery: catalysts for the right mod tags; flasks: Glassblower\'s Bauble.'),
      currency: cur ? [cost(cur, Math.max(1, Math.ceil(item.props.quality / 2)), '×4–20')] : [], station: T('Инвентарь', 'Inventory'), farm: farm(cur ?? '') })
  }
  const links = item.props.sockets?.links ?? 0
  if (links >= 5) {
    const n = links >= 6 ? 1500 : 150
    steps.push({ kind: 'finish', title: T(`Связать ${links} гнёзд`, `Link ${links} sockets`), currency: [cost('Orb of Fusing', n)],
      station: T('Верстак в убежище', 'Hideout crafting bench'), farm: farm('Orb of Fusing') })
  }
  for (const r of resolved.filter((x) => x.source === 'corrupted')) {
    const cp = [...d.mods.values()].filter((x) => x.gen === 'corrupted' && weightFor(x, base.tags) > 0)
    const Wc = cp.reduce((a, x) => a + weightFor(x, base.tags), 0)
    const w = weightFor(r.mod!, base.tags)
    const tries = 4 * (Wc / Math.max(1, w))
    steps.push({ kind: 'finish', title: T(`Порча Vaal Orb: «${r.text}»`, `Vaal Orb corruption: "${r.text}"`),
      detail: T(`Необратимо и всегда последним шагом: каждая попытка требует новой копии предмета. Нужный исход ≈ 1 из ${Math.round(tries)}.`, `Irreversible and always last: every attempt needs a new copy of the item. About 1 in ${Math.round(tries)}.`),
      currency: [cost('Vaal Orb', tries)], station: T('Инвентарь', 'Inventory'), farm: farm('Vaal Orb') })
  }

  const all = steps.flatMap((s) => s.currency)
  const totalChaos = all.length && all.every((c) => c.chaos != null) ? all.reduce((a, c) => a + (c.chaos ?? 0), 0) : all.length ? all.reduce((a, c) => a + (c.chaos ?? 0), 0) : 0
  if (all.some((c) => c.chaos == null)) warnings.push(T('Для части валюты нет цены на poe.ninja — итог занижен.', 'Some currency has no poe.ninja price, so the total is understated.'))

  return {
    method: best?.name ?? (explicit.length ? T('Нет метода', 'No method') : T('Только имплиситы / верстак', 'Implicits / bench only')),
    stage, ilvl: need, targets, steps, totalChaos, divine, warnings
  }
}

export type { CraftData }
