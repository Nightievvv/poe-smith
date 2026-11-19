/** Переводит нажатие клавиш в формат Electron Accelerator, например "Ctrl+Shift+F". */
export function accelFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const c = e.code
  let key: string
  if (c.startsWith('Key')) key = c.slice(3)
  else if (c.startsWith('Digit')) key = c.slice(5)
  else if (c.startsWith('Numpad') && /\d$/.test(c)) key = 'num' + c.slice(6)
  else if (/^F\d{1,2}$/.test(c)) key = c
  else {
    const map: Record<string, string> = {
      Tab: 'Tab', Space: 'Space', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=',
      BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete'
    }
    key = map[c]
    if (!key) return null
  }
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[]
  // без модификатора разрешаем только F-клавиши, чтобы не перехватывать обычный ввод в игре
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null
  return [...mods, key].join('+')
}

export function matches(e: KeyboardEvent, accel: string): boolean {
  return !!accel && accelFromEvent(e) === accel
}
