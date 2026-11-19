/**
 * Ограничитель запросов по заголовкам GGG:
 *   x-rate-limit-ip:       "max:period:penalty,..."   (например 5:10:60 — 5 запросов за 10 с, иначе бан на 60 с)
 *   x-rate-limit-ip-state: "count:period:activePenalty,..."
 * Запросы идут строго по одному; перед каждым ждём, пока во всех окнах останется запас в 1 запрос.
 */
interface Rule {
  max: number
  period: number // секунды
  /** моменты запросов, учтённые в этом окне (у каждого окна свой счётчик) */
  hits: number[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseRules(s: string): Rule[] {
  return s
    .split(',')
    .map((p) => p.split(':').map(Number))
    .filter((a) => a.length >= 2 && a.every((n) => Number.isFinite(n)))
    .map(([max, period]) => ({ max, period, hits: [] as number[] }))
}

export interface LimitState {
  used: number
  max: number
  period: number
  /** через сколько секунд снимется бан, 0 — бана нет */
  blockedFor: number
}

export class Limiter {
  private rules: Rule[]
  private blockedUntil = 0
  private chain: Promise<unknown> = Promise.resolve()

  constructor(defaults: string) {
    this.rules = parseRules(defaults)
  }

  schedule(fn: () => Promise<Response>): Promise<Response> {
    const run = async () => {
      await this.waitTurn()
      const now = Date.now()
      for (const r of this.rules) r.hits.push(now)
      const res = await fn()
      this.update(res)
      return res
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }

  private prune(now: number) {
    for (const r of this.rules) r.hits = r.hits.filter((t) => now - t < r.period * 1000)
  }

  private async waitTurn() {
    for (;;) {
      const now = Date.now()
      this.prune(now)
      let wait = Math.max(0, this.blockedUntil - now)
      for (const r of this.rules) {
        if (r.hits.length >= Math.max(1, r.max - 1)) wait = Math.max(wait, r.hits[0] + r.period * 1000 - now + 100)
      }
      if (wait <= 0) return
      await sleep(Math.min(wait, 5000))
    }
  }

  private update(res: Response) {
    const now = Date.now()
    const header = res.headers.get('x-rate-limit-ip')
    if (header) {
      // новые правила, но сохраняем уже накопленные счётчики окон с тем же периодом
      const old = this.rules
      this.rules = parseRules(header).map((r) => ({ ...r, hits: old.find((o) => o.period === r.period)?.hits ?? [] }))
    }
    const state = res.headers.get('x-rate-limit-ip-state')
    if (state) {
      for (const part of state.split(',')) {
        const [count, period, penalty] = part.split(':').map(Number)
        if (penalty > 0) this.blockedUntil = Math.max(this.blockedUntil, now + penalty * 1000)
        // сервер видит больше запросов с нашего IP (например, из браузера) — учитываем их только в этом окне
        const rule = this.rules.find((r) => r.period === period)
        if (rule) for (let k = rule.hits.length; k < count; k++) rule.hits.push(now)
      }
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? 60)
      this.blockedUntil = Math.max(this.blockedUntil, now + (Number.isFinite(ra) ? ra : 60) * 1000)
    }
    this.prune(now)
  }

  /** Самое «загруженное» окно — его и показываем пользователю. */
  state(): LimitState {
    const now = Date.now()
    this.prune(now)
    let best: LimitState = { used: 0, max: 1, period: 60, blockedFor: 0 }
    let ratio = -1
    for (const r of this.rules) {
      const used = r.hits.length
      if (used / r.max > ratio) {
        ratio = used / r.max
        best = { used, max: r.max, period: r.period, blockedFor: 0 }
      }
    }
    best.blockedFor = Math.max(0, Math.ceil((this.blockedUntil - now) / 1000))
    return best
  }
}
