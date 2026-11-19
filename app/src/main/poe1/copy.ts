import { clipboard } from 'electron'
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)')
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)')

const VK_CONTROL = 0x11
const VK_C = 0x43
const KEYUP = 0x0002
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Одно нажатие горячей клавиши → одно нажатие Ctrl+C в игре (так разрешают правила GGG).
 * Если пользователь держит Ctrl (Ctrl+D) — нажимаем только C; Alt, если зажат, превращает копию в расширенную.
 */
function sendCtrlC() {
  const ctrlHeld = (GetAsyncKeyState(VK_CONTROL) & 0x8000) !== 0
  if (!ctrlHeld) keybd_event(VK_CONTROL, 0, 0, 0)
  keybd_event(VK_C, 0, 0, 0)
  keybd_event(VK_C, 0, KEYUP, 0)
  if (!ctrlHeld) keybd_event(VK_CONTROL, 0, KEYUP, 0)
}

/** Копирует предмет под курсором и возвращает его текст; прежнее содержимое буфера восстанавливается. */
export async function copyItemText(): Promise<string | null> {
  // в Electron 45 буфер обмена асинхронный
  const prev = await clipboard.readText()
  await clipboard.writeText('')
  sendCtrlC()
  let text: string | null = null
  for (let i = 0; i < 15 && !text; i++) {
    await sleep(40)
    const t = await clipboard.readText()
    if (t.startsWith('Item Class:')) text = t
  }
  if (prev) await clipboard.writeText(prev)
  return text
}
