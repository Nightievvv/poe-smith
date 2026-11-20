import { useEffect, useRef, useState } from 'react'
import type { ExchangeData, ExchangeItem, StashShot } from '../../shared/types'
import { CurrencyAmount } from './Currency'
import { cellVector, detectSlots, iconDistance, iconVector, readCount, type Box } from './stash/vision'

/**
 * Окно оверлея склада (#stash): прозрачное, на всю область игры, клики проходят насквозь.
 * Получает снимок левой части окна игры и подписывает под каждой ячейкой цену «за 1 / за стак».
 */
interface Tpl {
  item: ExchangeItem
  v: Uint8ClampedArray
}
interface Label {
  key: string
  box: Box
  item: ExchangeItem | null
  count: number
  sure: boolean
}

/** Порог уверенности сравнения иконок и минимальный отрыв от второго кандидата. */
const MAX_DIST = 22
const MIN_GAP = 1.2

export function StashApp() {
  const [labels, setLabels] = useState<Label[]>([])
  const [geo, setGeo] = useState<{ offX: number; offY: number; scale: number; bg?: string } | null>(null)
  const [divine, setDivine] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle')
  const tpls = useRef<Tpl[] | null>(null)
  const loading = useRef<Promise<void> | null>(null)
  const empty = useRef(0)

  // иконки и цены биржи — один раз (кэш poe.ninja в main-процессе на 15 минут)
  const load = () => {
    if (loading.current) return loading.current
    setStatus('loading')
    loading.current = (async () => {
      const data: ExchangeData = await window.api.exchange()
      setDivine(data.divine)
      const icons = await window.api.exchangeIcons()
      const out: Tpl[] = []
      await Promise.all(
        data.items.map(async (item) => {
          const src = icons[item.id]
          const v = src ? await iconVector(src) : null
          if (v) out.push({ item, v })
        })
      )
      tpls.current = out
      setStatus('ready')
    })().catch(() => {
      loading.current = null
      setStatus('idle')
    })
    return loading.current
  }

  const analyze = async (shot: StashShot) => {
    // отладка: последний снимок доступен из DevTools
    if ((window as unknown as { debug?: unknown }).debug) (window as unknown as { __shot: StashShot }).__shot = shot
    await load()
    const T = tpls.current
    if (!T) return
    const boxes = detectSlots(shot, shot.screenH)
    if (!boxes.length) {
      // склад закрыт — после двух пустых снимков прячемся
      if (++empty.current >= 2) window.api.stashClose()
      setLabels([])
      return
    }
    empty.current = 0
    const out: Label[] = boxes.map((b) => {
      const v = cellVector(shot, b)
      let best: Tpl | null = null, d1 = Infinity, d2 = Infinity
      for (const t of T) {
        const d = iconDistance(v, t.v)
        if (d < d1) {
          if (best && best.item.id !== t.item.id) d2 = d1
          d1 = d
          best = t
        } else if (d < d2 && best?.item.id !== t.item.id) d2 = d
      }
      const ok = best && d1 <= MAX_DIST && d2 - d1 >= MIN_GAP
      const c = readCount(shot, b)
      return { key: `${b.x},${b.y}`, box: b, item: ok ? best!.item : null, count: c.n, sure: c.sure }
    })
    setGeo({ offX: shot.offX, offY: shot.offY, scale: shot.scale, bg: shot.debugBg })
    setLabels(out)
  }

  useEffect(() => {
    document.documentElement.classList.add('stash-root')
    void load()
    return window.api.onEvent((e) => {
      if (e.type !== 'stash') return
      if (!e.data) {
        setLabels([])
        empty.current = 0
        return
      }
      void analyze(e.data)
    })
  }, [])

  if (!geo) return status === 'loading' ? <div className="stash-status">PoESmith…</div> : null
  return (
    <div className="stash-ov">
      {geo.bg && <img src={geo.bg} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
      {labels.map((l) => {
        // подпись в две строки под ячейкой; заходит на низ ячейки не больше чем на ~1/4 её высоты
        const cell = l.box.h / geo.scale
        const left = (geo.offX + l.box.x + l.box.w / 2) / geo.scale
        const top = (geo.offY + l.box.y + l.box.h) / geo.scale - cell * 0.28
        const fs = Math.max(10, Math.min(14, cell * 0.21))
        return (
          <div key={l.key} className="stash-lbl" style={{ left, top, fontSize: fs, maxWidth: cell * 1.1, ['--ic' as string]: Math.round(fs + 3) + 'px' }}>
            {l.item ? <Price chaos={l.item.chaos} count={l.count} sure={l.sure} divine={divine} /> : <span className="stash-q">?</span>}
          </div>
        )
      })}
    </div>
  )
}

/** Цена в Chaos → число и валюта: от 1 Divine — в Divine. */
function amount(chaos: number, divine: number): { a: string; id: string } {
  const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : n >= 10 ? String(Math.round(n)) : n >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n >= 0.01 ? n.toFixed(2).replace(/0$/, '') : '<0.01')
  if (divine > 0 && chaos >= divine) return { a: fmt(chaos / divine), id: 'divine' }
  return { a: fmt(chaos), id: 'chaos' }
}

function Price({ chaos, count, sure, divine }: { chaos: number; count: number; sure: boolean; divine: number }) {
  const one = amount(chaos, divine)
  if (count <= 1 && sure) return <CurrencyAmount amount={one.a} id={one.id} />
  const all = amount(chaos * count, divine)
  return (
    <>
      <CurrencyAmount amount={one.a} id={one.id} />
      {sure ? <CurrencyAmount amount={all.a} id={all.id} /> : <span className="stash-q">×?</span>}
    </>
  )
}
