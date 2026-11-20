import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)')
const GetTopWindow = user32.func('void* __stdcall GetTopWindow(void* hWnd)')
const GetWindow = user32.func('void* __stdcall GetWindow(void* hWnd, uint32 uCmd)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void* hWnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(void* hWnd)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)')
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(void* hWnd, uint32 dwAttribute, _Out_ uint32* pvAttribute, uint32 cbAttribute)')
const FindWindowW = user32.func('void* __stdcall FindWindowW(const char16_t* cls, const char16_t* name)')
const GetClientRect = user32.func('bool __stdcall GetClientRect(void* hWnd, _Out_ RECT* lpRect)')
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' })
const ClientToScreen = user32.func('bool __stdcall ClientToScreen(void* hWnd, _Inout_ POINT* p)')
const GW_HWNDNEXT = 2
const DWMWA_CLOAKED = 14

function title(h: unknown): string {
  const buf = Buffer.alloc(512)
  const n = GetWindowTextW(h, buf, 256) as number
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
}

/** Заголовок активного окна Windows. */
export function foregroundTitle(): string {
  const h = GetForegroundWindow()
  return h ? title(h) : ''
}

/** HWND окна Electron (getNativeWindowHandle) → число для сравнения. */
export const hwndOf = (b: Buffer) => (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)))

/**
 * Заголовок окна, которое сейчас видно сверху в точке (x, y) экрана (в физических пикселях):
 * идём по z-порядку от верхнего окна и берём первое видимое, несвёрнутое, не «скрытое» (cloaked) окно,
 * которое накрывает точку. Свои окна (exclude) пропускаем — они висят поверх всего.
 */
export function visibleTitleAt(x: number, y: number, exclude: bigint[]): string | null {
  let h = GetTopWindow(null)
  for (let i = 0; h && i < 2000; i++, h = GetWindow(h, GW_HWNDNEXT)) {
    if (exclude.includes(BigInt(koffi.address(h)))) continue
    if (!IsWindowVisible(h) || IsIconic(h)) continue
    const cloaked = [0]
    if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) continue
    const r = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!GetWindowRect(h, r)) continue
    if (r.right - r.left < 2 || r.bottom - r.top < 2) continue
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue
    return title(h)
  }
  return null
}

/** Окно игры PoE 1 называется «Path of Exile» (у PoE 2 — «Path of Exile 2»). */
export const isGameTitle = (title: string) => /^Path of Exile( 2)?$/.test(title.trim())

/** Клиентская область окна игры на экране (физические пиксели); null — окно не найдено или свёрнуто. */
export function gameClientRect(): { x: number; y: number; width: number; height: number } | null {
  for (const name of ['Path of Exile', 'Path of Exile 2']) {
    const h = FindWindowW(null, name)
    if (!h || IsIconic(h)) continue
    const r = { left: 0, top: 0, right: 0, bottom: 0 }
    if (!GetClientRect(h, r)) continue
    const p = { x: 0, y: 0 }
    if (!ClientToScreen(h, p)) continue
    const width = r.right - r.left, height = r.bottom - r.top
    if (width < 100 || height < 100) continue
    return { x: p.x, y: p.y, width, height }
  }
  return null
}
