import { Notification } from 'electron'
import type { ParsedItem, Settings } from '../shared/types'
import { scanOne } from './poe1/market'
import { buildPlan } from './poe1/planner'
import { basePrice } from './poe1/baseprice'

/**
 * Фоновая проверка избранных профилей: раз в N минут — один поиск на профиль, план крафта по профилю
 * и уведомление Windows, если ожидаемая маржа лучшего варианта не ниже 30%.
 * Один и тот же профиль не беспокоит чаще раза в 6 часов.
 */
const TARGET_MARGIN = 0.3
const QUIET_MS = 6 * 3600 * 1000
const lastNotified = new Map<string, number>()
let timer: NodeJS.Timeout | null = null
let running = false

export interface WatcherDeps {
  settings: () => Settings
  league: () => Promise<string>
  openCraft: (item: ParsedItem) => void
  onLimits: () => void
}

async function tick(deps: WatcherDeps) {
  const s = deps.settings()
  if (!s.notify || !s.favorites.length || running) return
  running = true
  try {
    const league = await deps.league()
    for (const f of s.favorites) {
      try {
        const q = { slot: f.slot, subtype: f.subtype, minValue: f.minValue, minCurrency: f.minCurrency }
        const r = await scanOne(league, q, f.profileId, s)
        deps.onLimits()
        if (!r?.craftItem || !r.median || !r.divine) continue
        const item: ParsedItem = { ...r.craftItem, name: f.name[s.lang] }
        const plan = await buildPlan(item, item.mods.map((_, i) => i), s.lang, league, {
          customPrices: s.customPrices,
          basePrice: (b, lvl) => basePrice(league, b, lvl)
        })
        deps.onLimits()
        const best = plan.variants[0]
        if (!best) continue
        const value = r.median * r.divine
        const cost = (best.costMin + best.costMax) / 2
        const margin = (value - cost) / value
        const last = lastNotified.get(f.profileId) ?? 0
        if (margin >= TARGET_MARGIN && Date.now() - last > QUIET_MS && Notification.isSupported()) {
          lastNotified.set(f.profileId, Date.now())
          const div = (c: number) => `${(c / r.divine!).toFixed(1)} div`
          const n = new Notification({
            title: s.lang === 'ru' ? `Выгодный крафт: ${f.name.ru}` : `Profitable craft: ${f.name.en}`,
            body: s.lang === 'ru'
              ? `Маржа ~${Math.round(margin * 100)}%: продажа ~${div(value)}, крафт ~${div(cost)} (${best.name}).`
              : `Margin ~${Math.round(margin * 100)}%: sells ~${div(value)}, craft ~${div(cost)} (${best.name}).`
          })
          n.on('click', () => deps.openCraft({ ...item, valueDiv: r.median }))
          n.show()
        }
      } catch {
        /* трейд недоступен или лимит — попробуем в следующий раз */
      }
    }
  } finally {
    running = false
  }
}

export function startWatcher(deps: WatcherDeps) {
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      await tick(deps)
      schedule()
    }, deps.settings().notifyEveryMin * 60 * 1000)
  }
  // первая проверка — через 2 минуты после запуска
  setTimeout(() => tick(deps), 2 * 60 * 1000)
  schedule()
}

/** Ручной запуск проверки (кнопка в настройках). */
export const checkNow = (deps: WatcherDeps) => tick(deps)
