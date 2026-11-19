import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)')

/** Заголовок активного окна Windows. */
export function foregroundTitle(): string {
  const h = GetForegroundWindow()
  if (!h) return ''
  const buf = Buffer.alloc(512)
  const n = GetWindowTextW(h, buf, 256) as number
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
}

/** Окно игры PoE 1 называется «Path of Exile» (у PoE 2 — «Path of Exile 2»). */
export const isGameTitle = (title: string) => /^Path of Exile( 2)?$/.test(title.trim())
