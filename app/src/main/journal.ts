import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { JournalEntry } from '../shared/types'

/** Журнал крафтов: %APPDATA%/PoESmith/journal.json */
const file = () => join(app.getPath('userData'), 'journal.json')

export function listJournal(): JournalEntry[] {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf-8')) as JournalEntry[]) : []
  } catch {
    return []
  }
}

const write = (list: JournalEntry[]) => writeFileSync(file(), JSON.stringify(list, null, 2), 'utf-8')

export function addJournal(e: Omit<JournalEntry, 'id' | 'date'>): JournalEntry {
  const entry: JournalEntry = { ...e, id: 'j-' + Date.now(), date: Date.now() }
  write([entry, ...listJournal()])
  return entry
}

export function updateJournal(id: string, patch: Partial<JournalEntry>) {
  write(listJournal().map((e) => (e.id === id ? { ...e, ...patch, id: e.id, date: e.date } : e)))
}

export function removeJournal(id: string) {
  write(listJournal().filter((e) => e.id !== id))
}
