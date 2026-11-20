/**
 * Распознавание вкладки склада по снимку экрана — без заранее заданной раскладки, для любого разрешения:
 *  1) занятые ячейки — тёмно-синий фон (у пустых — серый силуэт на чёрном);
 *  2) предмет — сравнение уменьшенной ячейки с иконками poe.ninja (левый верх с цифрами не сравниваем);
 *  3) количество — белые цифры в левом верхнем углу: разбиение на символы и сравнение с эталонами шрифта PoE.
 */
import { DIGITS } from './digits'

export interface Img {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Занятые ячейки в левой части экрана (там, где склад). screenH — высота экрана игры в пикселях снимка. */
export function detectSlots(d: Img, screenH: number): Box[] {
  const H = screenH
  const w = d.width, h = d.height
  const m = new Uint8Array(w * h)
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2]
    m[p] = b >= r + 10 && b >= g + 8 && b < 120 && r < 60 ? 1 : 0
  }
  const seen = new Uint8Array(w * h)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue
    stack.length = 0
    stack.push(s)
    seen[s] = 1
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && m[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1)
      if (x < w - 1 && m[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1)
      if (y > 0 && m[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w)
      if (y < h - 1 && m[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w)
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    if (bw > 0.025 * H && bh > 0.025 * H && bw < 0.08 * H && bh < 0.08 * H && Math.abs(bw - bh) < 0.3 * Math.max(bw, bh)) boxes.push({ x: x0, y: y0, w: bw, h: bh })
  }
  const s = median(boxes.map((b) => b.h)) || 1
  return boxes.sort((a, b) => Math.round(a.y / (s * 0.5)) - Math.round(b.y / (s * 0.5)) || a.x - b.x)
}

const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

// ---------- иконки ----------
export const ICON_N = 24

/** Ячейка, уменьшенная до ICON_N×ICON_N (RGBA), через canvas. */
export function cellVector(d: Img, b: Box): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = b.w
  c.height = b.h
  const id = new ImageData(b.w, b.h)
  for (let y = 0; y < b.h; y++) {
    const src = ((b.y + y) * d.width + b.x) * 4
    id.data.set(d.data.subarray(src, src + b.w * 4), y * b.w * 4)
  }
  c.getContext('2d')!.putImageData(id, 0, 0)
  const o = document.createElement('canvas')
  o.width = o.height = ICON_N
  const g = o.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(c, 0, 0, ICON_N, ICON_N)
  return g.getImageData(0, 0, ICON_N, ICON_N).data
}

/** Иконка poe.ninja → ICON_N×ICON_N RGBA. */
export async function iconVector(src: string): Promise<Uint8ClampedArray | null> {
  const im = new Image()
  im.src = src
  try {
    await im.decode()
  } catch {
    return null
  }
  const o = document.createElement('canvas')
  o.width = o.height = ICON_N
  const g = o.getContext('2d', { willReadFrequently: true })!
  g.drawImage(im, 0, 0, ICON_N, ICON_N)
  return g.getImageData(0, 0, ICON_N, ICON_N).data
}

const BG = [12, 10, 35]
/** Среднее отличие ячейки от иконки на тёмно-синем фоне; угол с цифрами стака пропускаем. */
export function iconDistance(s: Uint8ClampedArray, t: Uint8ClampedArray): number {
  const N = ICON_N
  let sum = 0, n = 0
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (y < N * 0.38 && x < N * 0.7) continue
      const i = (y * N + x) * 4, a = t[i + 3] / 255
      for (let k = 0; k < 3; k++) sum += Math.abs(t[i + k] * a + BG[k] * (1 - a) - s[i + k])
      n += 3
    }
  return sum / n
}

// ---------- цифры стака ----------
export interface Glyph {
  v: number[]
  aspect: number
  top: number
  hgt: number
}
const GW = 8, GH = 12

/** Символы числа в левом верхнем углу ячейки, слева направо. */
export function glyphs(d: Img, b: Box): Glyph[] {
  const s = b.h, X0 = b.x - Math.round(0.1 * s), Y0 = b.y - Math.round(0.08 * s), w = Math.round(1.0 * s), h = Math.round(0.6 * s)
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = X0 + x, yy = Y0 + y
      if (xx < 0 || yy < 0 || xx >= d.width || yy >= d.height) continue
      const i = (yy * d.width + xx) * 4, r = d.data[i], g = d.data[i + 1], bl = d.data[i + 2]
      const mn = Math.min(r, g, bl), mx = Math.max(r, g, bl)
      m[y * w + x] = mn > 140 && mx - mn < 60 ? 1 : 0
    }
  const lab = new Int32Array(w * h)
  type C = { id: number; x0: number; x1: number; y0: number; y1: number; n: number }
  const comps: C[] = []
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!m[p0] || lab[p0]) continue
    const id = comps.length + 1, st = [p0]
    lab[p0] = id
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0
    while (st.length) {
      const p = st.pop()!, x = p % w, y = (p / w) | 0
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const a = x + dx, c = y + dy
          if (a < 0 || c < 0 || a >= w || c >= h) continue
          const q = c * w + a
          if (m[q] && !lab[q]) {
            lab[q] = id
            st.push(q)
          }
        }
    }
    comps.push({ id, x0, x1, y0, y1, n })
  }
  // цифра слилась с белой иконкой — берём левую часть компонента шириной с цифру
  const big = (c: C) => c.x1 - c.x0 + 1 > 0.3 * s || c.y1 - c.y0 + 1 > 0.42 * s
  const cut = (c: C): C | null => {
    const xb = Math.min(c.x1, c.x0 + Math.round(0.13 * s))
    let y0 = 1e9, y1 = -1
    for (let x = c.x0; x <= xb; x++)
      for (let y = 0; y < Math.round(0.45 * s); y++)
        if (lab[y * w + x] === c.id) {
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    return y1 < 0 ? null : { ...c, x1: xb, y0, y1 }
  }
  const cand = comps
    .map((c) => (big(c) && c.y0 < 0.3 * s ? cut(c) : c))
    .filter((c): c is C => {
      if (!c) return false
      const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1
      return ch >= 0.14 * s && ch <= 0.42 * s && cw <= 0.3 * s && c.y0 < 0.35 * s && c.n >= 0.005 * s * s
    })
    .sort((a, b) => a.x0 - b.x0)
  const chain: C[] = []
  for (const c of cand) {
    if (!chain.length) {
      if (c.x0 < 0.35 * s) chain.push(c)
      continue
    }
    const p = chain[chain.length - 1]
    if (c.x0 - p.x1 > 0.12 * s) break
    if (c.x0 <= p.x1) continue
    chain.push(c)
  }
  if (!chain.length) return []
  const ref = Math.min(...chain.map((c) => c.y0))
  return chain.map((c) => {
    const v: number[] = new Array(GW * GH).fill(0)
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        let a = 0, k = 0
        const ya = Math.floor((y * ch) / GH), yb = Math.max(ya + 1, Math.floor(((y + 1) * ch) / GH))
        const xa = Math.floor((x * cw) / GW), xb = Math.max(xa + 1, Math.floor(((x + 1) * cw) / GW))
        for (let yy = ya; yy < yb; yy++)
          for (let xx = xa; xx < xb; xx++) {
            a += lab[(c.y0 + yy) * w + c.x0 + xx] === c.id ? 1 : 0
            k++
          }
        v[y * GW + x] = a / k
      }
    return { v, aspect: cw / ch, top: (c.y0 - ref) / s, hgt: ch / s }
  })
}

const glyphDist = (g: Glyph, l: Glyph) => {
  let s = 0
  for (let k = 0; k < g.v.length; k++) s += (g.v[k] - l.v[k]) ** 2
  return s + 3 * (g.aspect - l.aspect) ** 2 + 40 * (g.top - l.top) ** 2 + 40 * (g.hgt - l.hgt) ** 2
}

/** Количество в стаке; null — не удалось прочитать (у предмета без числа количество 1). */
export function readCount(d: Img, b: Box): { n: number; sure: boolean } {
  const gs = glyphs(d, b)
  if (!gs.length) return { n: 1, sure: true }
  const best = gs.map((g) => {
    let b = { ch: '', s: Infinity }
    for (const l of DIGITS) {
      const s = glyphDist(g, l)
      if (s < b.s) b = { ch: l.ch, s }
    }
    return b
  })
  // ни одного похожего на цифру символа — числа нет (стак из 1)
  const firstGood = best.findIndex((b) => b.s <= 22)
  if (firstGood < 0) return { n: 1, sure: true }
  // первая цифра может слиться с белой иконкой (плохое совпадение) — берём её, но число помечаем как неточное
  let out = ''
  let worst = 0
  for (let i = 0; i < best.length; i++) {
    if (i > firstGood && best[i].s > 22) break // после числа — кусок иконки
    if (i < firstGood && i < firstGood - 1) continue
    worst = Math.max(worst, best[i].s)
    out += best[i].ch
  }
  const n = Number(out)
  if (!out || !Number.isFinite(n) || n <= 0) return { n: 1, sure: false }
  return { n, sure: worst <= 18 }
}
