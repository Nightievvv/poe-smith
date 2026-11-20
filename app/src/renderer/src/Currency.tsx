import { useEffect, useState } from 'react'
import type { CurrencyIcon } from '../../shared/types'

/** Общий кэш иконок на всё окно: каждая валюта запрашивается у main-процесса один раз. */
const cache = new Map<string, CurrencyIcon | null>()
const pending = new Map<string, Promise<void>>()
const subs = new Set<() => void>()

function request(ids: string[]) {
  const need = ids.filter((id) => !cache.has(id) && !pending.has(id))
  if (!need.length) return
  const p = window.api
    .currencyIcons(need)
    .then((r) => {
      for (const id of need) cache.set(id, r[id] ?? null)
    })
    .catch(() => {
      for (const id of need) cache.set(id, null)
    })
    .finally(() => {
      for (const id of need) pending.delete(id)
      subs.forEach((f) => f())
    })
  for (const id of need) pending.set(id, p)
}

function useIcon(id: string): CurrencyIcon | null | undefined {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    request([id])
    return () => {
      subs.delete(f)
    }
  }, [id])
  return cache.get(id)
}

/** Названия валюты в цене лота («25 divine») → id трейда. */
const ALIAS: Record<string, string> = { div: 'divine', c: 'chaos', ex: 'exalted', exa: 'exalted' }

/** «25 divine» → { amount: 25, id: 'divine' } */
export function parsePrice(s: string): { amount: number; id: string } | null {
  const m = s.trim().match(/^(-?\d+(?:[.,]\d+)?)\s+(.+)$/)
  if (!m) return null
  const id = m[2].trim().toLowerCase()
  return { amount: Number(m[1].replace(',', '.')), id: ALIAS[id] ?? id }
}

/** Цена в Divine → число и валюта: от 1 div — в Divine, дешевле — в Chaos (как fmtPrice). */
export function divParts(div: number, chaosPerDiv?: number): { amount: string; id: string } | null {
  if (!div) return null
  if (div >= 1 || !chaosPerDiv) return { amount: div >= 10 ? String(Math.round(div)) : div.toFixed(1), id: 'divine' }
  return { amount: String(Math.max(1, Math.round(div * chaosPerDiv))), id: 'chaos' }
}

/** Число + иконка валюты; пока иконки нет (или она недоступна) — текстом. */
export function CurrencyAmount({ amount, id, className }: { amount: string | number; id: string; className?: string }) {
  const ic = useIcon(id)
  return (
    <span className={'cur-amt' + (className ? ' ' + className : '')} title={ic?.name ?? id}>
      {amount}
      {ic ? <img src={ic.src} alt={ic.name} /> : <span className="cur-id">{id}</span>}
    </span>
  )
}
