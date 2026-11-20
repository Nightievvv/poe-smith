import { useEffect, useState } from 'react'

/**
 * Иконки валюты по английскому названию (как в шагах плана: «Exalted Orb», «Shrieking Essence of Envy»).
 * Источник — биржа poe.ninja: один запрос списка и иконок на всё окно.
 */
let cache: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null

function load(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache)
  if (!pending)
    pending = (async () => {
      const data = await window.api.exchange()
      const icons = await window.api.exchangeIcons()
      const out: Record<string, string> = {}
      for (const i of data.items) if (icons[i.id]) out[i.name] = icons[i.id]
      cache = out
      return out
    })().catch(() => {
      pending = null
      return {}
    })
  return pending
}

export function useItemIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>(cache ?? {})
  useEffect(() => {
    let alive = true
    load().then((r) => alive && setIcons(r))
    return () => {
      alive = false
    }
  }, [])
  return icons
}
