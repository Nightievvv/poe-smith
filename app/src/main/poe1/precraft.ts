import type { CraftStep, CraftVariant, Lang, ParsedItem } from '../../shared/types'
import { ensureStats, matchStat } from './stats'
import { search, fetchListings, tradeUrl } from './trade'
import { getRates } from './ninja'
import { listingToItem } from './listing'
import { buildPlan, type PlanOptions } from './planner'

/**
 * «Заготовка + докрафт»: вместо крафта с нуля купить предмет, на котором уже есть часть нужных модов, и доделать его.
 * Один поиск трейда с группой «count» находит предметы той же базы, где есть хотя бы k из n нужных модов
 * (k = n−1, затем n−2). Для самых дешёвых считаем докрафт: лишние моды снять, недостающие добавить.
 * Итог — цена лота + докрафт; варианты сравниваются с крафтом с нуля в одном списке.
 */
const CANDIDATES = 5

export async function precraftVariants(league: string, item: ParsedItem, targetIdx: number[], lang: Lang, opts: PlanOptions): Promise<CraftVariant[]> {
  const T = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  await ensureStats().catch(() => undefined)
  const preferLocal = !!(item.props.weapon || item.props.defence)
  const targets = targetIdx
    .map((i) => item.mods[i])
    .filter((m) => m && (m.kind === 'explicit' || m.kind === 'fractured'))
    .map((m) => ({ text: m.text, hit: matchStat(m.text, m.kind, preferLocal) }))
    .filter((x): x is { text: string; hit: { id: string; value: number | null } } => !!x.hit)
  const n = targets.length
  if (n < 2) return []
  const rates = await getRates(league)
  const ks = [n - 1, n - 2].filter((k) => k >= 1)
  const listings: { l: Awaited<ReturnType<typeof fetchListings>>[number]; url: string }[] = []
  for (const k of ks) {
    const query = {
      status: { option: 'available' },
      type: item.baseType,
      stats: [{ type: 'count', value: { min: k }, filters: targets.map((x) => ({ id: x.hit.id, value: x.hit.value != null ? { min: Math.floor(x.hit.value) } : {} })) }],
      filters: {
        type_filters: { filters: { rarity: { option: 'nonunique' } } },
        misc_filters: { filters: { corrupted: { option: 'false' }, ...(item.itemLevel ? { ilvl: { min: Math.min(item.itemLevel, 86) - 2 } } : {}) } },
        trade_filters: { filters: { sale_type: { option: 'priced' } } }
      }
    }
    const s = await search(league, { query, sort: { price: 'asc' } })
    if (!s.result.length) continue
    const got = await fetchListings(s.result.slice(0, CANDIDATES), s.id)
    for (const l of got) if (!listings.some((x) => x.l.id === l.id)) listings.push({ l, url: tradeUrl(league, s.id) })
  }

  const out: CraftVariant[] = []
  for (const { l, url } of listings) {
    const pr = l.listing.price
    const per = pr ? rates.chaosPer[pr.currency] : undefined
    if (!pr || !per) continue
    const priceChaos = pr.amount * per
    const lot = listingToItem(l, item.slot)
    // какие нужные моды уже есть на лоте (тот же стат, значение не ниже)
    const have = new Set<number>()
    const keep: number[] = []
    lot.mods.forEach((m, i) => {
      if (m.kind === 'implicit' || m.kind === 'enchant') return keep.push(i)
      const h = matchStat(m.text, m.kind, preferLocal)
      const ti = targets.findIndex((x, j) => !have.has(j) && h && x.hit.id === h.id && (x.hit.value == null || (h.value ?? 0) >= x.hit.value))
      if (ti >= 0) {
        have.add(ti)
        keep.push(i)
      }
    })
    const missing = targets.filter((_, j) => !have.has(j)).map((x) => x.text)
    try {
      const plan = await buildPlan(lot, keep, lang, league, { ...opts, mode: 'finish', addTexts: missing, basePrice: undefined })
      const best = plan.variants[0]
      if (!best && missing.length) continue
      const buy: CraftStep = {
        kind: 'base', method: 'Trade',
        title: T(`Купить заготовку: ${lot.name || lot.baseType} (${have.size} из ${n} нужных модов)`, `Buy a base: ${lot.name || lot.baseType} (${have.size} of ${n} wanted mods)`),
        lines: [
          T(`Лот на трейде: ${pr.amount} ${pr.currency}, продавец ${l.listing.account.name}.`, `Trade listing: ${pr.amount} ${pr.currency}, seller ${l.listing.account.name}.`),
          ...(missing.length ? [T('Докрафтить:', 'Still to add:'), ...missing.map((m) => ({ mod: m }))] : [T('Все нужные моды уже есть.', 'All wanted mods are already there.')])
        ],
        currency: [{ name: T('Заготовка с трейда', 'Base from trade'), count: '×1', chaos: priceChaos }],
        station: T('Трейд', 'Trade'), url, cost: [priceChaos, priceChaos], costMiss: [priceChaos, priceChaos]
      }
      const add = (x: number | undefined) => (x ?? 0) + priceChaos
      const steps = best ? best.steps : []
      out.push({
        name: T(`Заготовка с трейда + докрафт (${have.size}/${n})`, `Trade base + finish (${have.size}/${n})`),
        mechanics: ['Trade', ...(best?.mechanics ?? [])],
        steps: [buy, ...steps],
        totalChaos: add(best?.totalChaos ?? 0),
        costMin: add(best?.costMin), costMax: add(best?.costMax), costMissMin: add(best?.costMissMin), costMissMax: add(best?.costMissMax),
        costP50: add(best?.costP50), costP90: add(best?.costP90),
        notes: [T('Лот могут продать раньше вас — перед покупкой проверьте его на трейде.', 'The listing may sell first: check it on trade before buying.')]
      })
    } catch {
      /* лот не удалось разобрать — пропускаем */
    }
  }
  return out.sort((a, b) => (a.costP50 ?? a.costMissMax) - (b.costP50 ?? b.costMissMax)).slice(0, 3)
}
