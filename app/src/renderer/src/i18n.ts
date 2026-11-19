import type { HotkeyId, Lang } from '../../shared/types'

const ru = {
  'tab.craft': 'Крафт',
  'tab.market': 'Рынок',
  'tab.settings': 'Настройки',
  'hide': 'Скрыть',
  'clickThroughOn': 'Клики проходят сквозь окно',

  'craft.slot': 'Слот',
  'craft.placeholder': 'Пошаговые рецепты крафта появятся на этапе 3: шаблоны методов + подстановка модов и цен.',
  'craft.readHint': 'Наведите курсор на предмет в игре и нажмите {key} — оверлей прочитает предмет и подберёт рецепт (этап 2).',
  'market.slot': 'Слот · редкие',
  'market.placeholder': 'Сканер трейда и poe.ninja появится на этапе 2: профили редких предметов, медиана без выбросов, спрос.',

  'set.game': 'Игра',
  'set.version': 'Версия',
  'set.poe2later': 'Path of Exile 2 (позже)',
  'set.league': 'Лига',
  'set.leagueAuto': 'Текущая Softcore ({id})',
  'set.leagueAutoUnknown': 'Текущая Softcore (не удалось определить)',
  'set.leagueError': 'Не удалось загрузить список лиг: {err}. Показаны только постоянные лиги.',
  'set.lang': 'Язык интерфейса',

  'set.hotkeys': 'Горячие клавиши',
  'set.hkHint': 'Нажмите на сочетание, затем новые клавиши. Esc отменяет, Backspace снимает назначение. Не занимайте клавиши, которые используются в самой игре.',
  'set.hkPress': 'Нажмите клавиши…',
  'set.hkNone': 'не назначено',
  'set.hkConflict': 'Сочетание {keys} назначено нескольким действиям. Измените одно из них.',
  'set.hkFailed': 'Не удалось назначить: {list}. Возможно, сочетание занято другой программой.',
  'set.hkLocal': 'только в окне оверлея',

  'set.window': 'Окно',
  'set.opacity': 'Непрозрачность',
  'set.clickThrough': 'Клики проходят сквозь окно',

  'set.account': 'Аккаунт трейда',
  'set.sess': 'POESESSID (необязательно)',
  'set.sessPh': '32 символа из cookie pathofexile.com',
  'set.show': 'Показать',
  'set.hideVal': 'Скрыть',
  'set.save': 'Сохранить',
  'set.clear': 'Удалить',
  'set.sessNone': 'Не задан. Поиск работает и без него, но лимиты запросов строже.',
  'set.sessSaved': 'Сохранён на этом компьютере в зашифрованном виде.',
  'set.sessFormat': 'POESESSID — это 32 шестнадцатеричных символа. Проверьте, что скопировали значение cookie целиком.',
  'set.sessEnc': 'Шифрование Windows недоступно, поэтому значение не сохранено.',

  'set.scanner': 'Сканер рынка',
  'set.source': 'Курсы валют и история цен',
  'set.interval': 'Обновление кэша',
  'set.int.30m': 'каждые 30 мин',
  'set.int.1h': 'каждый час',
  'set.int.manual': 'вручную',
  'set.outlier': 'Отсечение выбросов',
  'set.out.iqr1.5': 'IQR × 1.5 (стандарт)',
  'set.out.iqr3': 'IQR × 3 (мягко)',
  'set.out.p10-90': 'Перцентили 10–90',
  'set.age': 'Учитывать лоты не старше',
  'set.days': '{n} дн.',

  'hk.toggle': 'Показать / скрыть оверлей',
  'hk.read': 'Прочитать предмет под курсором и открыть крафт',
  'hk.price': 'Оценить предмет под курсором на рынке',
  'hk.click': 'Включить / выключить клики насквозь',
  'hk.step': 'Отметить следующий шаг крафта',
  'hk.tab': 'Следующая вкладка оверлея',

  'g.armour': 'Броня', 'g.jewellery': 'Бижутерия', 'g.weapons': 'Оружие', 'g.jewels': 'Самоцветы', 'g.flasks': 'Флаконы',
  's.helmet': 'Шлем', 's.body': 'Нательная броня', 's.gloves': 'Перчатки', 's.boots': 'Обувь', 's.shield': 'Щит',
  's.amulet': 'Амулет', 's.ring': 'Кольцо', 's.belt': 'Пояс',
  's.weapon1': 'Одноручное оружие', 's.weapon2': 'Двуручное оружие', 's.quiver': 'Колчан',
  's.jewel': 'Самоцвет', 's.abyss': 'Абиссальный самоцвет', 's.cluster': 'Кластерный самоцвет', 's.flask': 'Флакон'
}

type Key = keyof typeof ru

const en: Record<Key, string> = {
  'tab.craft': 'Craft',
  'tab.market': 'Market',
  'tab.settings': 'Settings',
  'hide': 'Hide',
  'clickThroughOn': 'Click-through is on',

  'craft.slot': 'Slot',
  'craft.placeholder': 'Step-by-step crafting recipes arrive in stage 3: method templates filled with your mods and live prices.',
  'craft.readHint': 'Hover an item in game and press {key}: the overlay will read it and suggest a recipe (stage 2).',
  'market.slot': 'Slot · rares',
  'market.placeholder': 'Trade and poe.ninja scanner arrives in stage 2: rare item profiles, outlier-free median, demand.',

  'set.game': 'Game',
  'set.version': 'Version',
  'set.poe2later': 'Path of Exile 2 (later)',
  'set.league': 'League',
  'set.leagueAuto': 'Current Softcore ({id})',
  'set.leagueAutoUnknown': 'Current Softcore (could not detect)',
  'set.leagueError': 'Could not load leagues: {err}. Showing permanent leagues only.',
  'set.lang': 'Interface language',

  'set.hotkeys': 'Hotkeys',
  'set.hkHint': 'Click a shortcut, then press the new keys. Esc cancels, Backspace clears. Avoid keys the game already uses.',
  'set.hkPress': 'Press keys…',
  'set.hkNone': 'not set',
  'set.hkConflict': '{keys} is assigned to several actions. Change one of them.',
  'set.hkFailed': 'Could not register: {list}. Another program may be using the shortcut.',
  'set.hkLocal': 'overlay window only',

  'set.window': 'Window',
  'set.opacity': 'Opacity',
  'set.clickThrough': 'Click-through',

  'set.account': 'Trade account',
  'set.sess': 'POESESSID (optional)',
  'set.sessPh': '32 characters from the pathofexile.com cookie',
  'set.show': 'Show',
  'set.hideVal': 'Hide',
  'set.save': 'Save',
  'set.clear': 'Remove',
  'set.sessNone': 'Not set. Search works without it, but rate limits are stricter.',
  'set.sessSaved': 'Saved on this computer, encrypted.',
  'set.sessFormat': 'POESESSID is 32 hexadecimal characters. Make sure you copied the whole cookie value.',
  'set.sessEnc': 'Windows encryption is unavailable, so the value was not saved.',

  'set.scanner': 'Market scanner',
  'set.source': 'Currency rates and price history',
  'set.interval': 'Cache refresh',
  'set.int.30m': 'every 30 min',
  'set.int.1h': 'every hour',
  'set.int.manual': 'manual',
  'set.outlier': 'Outlier filter',
  'set.out.iqr1.5': 'IQR × 1.5 (default)',
  'set.out.iqr3': 'IQR × 3 (loose)',
  'set.out.p10-90': 'Percentiles 10–90',
  'set.age': 'Ignore listings older than',
  'set.days': '{n} days',

  'hk.toggle': 'Show / hide overlay',
  'hk.read': 'Read hovered item and open Craft',
  'hk.price': 'Price-check hovered item',
  'hk.click': 'Toggle click-through',
  'hk.step': 'Mark next craft step done',
  'hk.tab': 'Next overlay tab',

  'g.armour': 'Armour', 'g.jewellery': 'Jewellery', 'g.weapons': 'Weapons', 'g.jewels': 'Jewels', 'g.flasks': 'Flasks',
  's.helmet': 'Helmet', 's.body': 'Body armour', 's.gloves': 'Gloves', 's.boots': 'Boots', 's.shield': 'Shield',
  's.amulet': 'Amulet', 's.ring': 'Ring', 's.belt': 'Belt',
  's.weapon1': 'One-hand weapon', 's.weapon2': 'Two-hand weapon', 's.quiver': 'Quiver',
  's.jewel': 'Jewel', 's.abyss': 'Abyss jewel', 's.cluster': 'Cluster jewel', 's.flask': 'Flask'
}

const dicts: Record<Lang, Record<Key, string>> = { ru, en }

export type T = (key: Key, vars?: Record<string, string | number>) => string

export function makeT(lang: Lang): T {
  return (key, vars) => {
    let s = dicts[lang][key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
    return s
  }
}

export const hotkeyLabel = (t: T, id: HotkeyId) => t(`hk.${id}` as Key)

export const SLOT_GROUPS: [Key, Key[]][] = [
  ['g.armour', ['s.helmet', 's.body', 's.gloves', 's.boots', 's.shield']],
  ['g.jewellery', ['s.amulet', 's.ring', 's.belt']],
  ['g.weapons', ['s.weapon1', 's.weapon2', 's.quiver']],
  ['g.jewels', ['s.jewel', 's.abyss', 's.cluster']],
  ['g.flasks', ['s.flask']]
]
