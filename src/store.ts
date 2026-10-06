// Books, reading positions and typing totals live in Supabase. Only per-browser preferences
// (passage size, which book was open) stay in localStorage.
import { supabase } from './supabase'

export type BookMeta = {
  id: string
  title: string
  wordCount: number
  pos: number // index of the next word to type
  addedAt: number
  stats?: BookStats
}

// Running totals over every finished passage.
export type BookStats = {
  seconds: number
  chars: number // characters that count towards wpm
  keys: number
  errors: number
}

const CURRENT_KEY = 'retype.current'
const SIZE_KEY = 'retype.passageSize'

export const PASSAGE_SIZES = [25, 50, 100, 200]

export function loadCurrent(): string | null {
  return localStorage.getItem(CURRENT_KEY)
}

export function saveCurrent(id: string | null) {
  if (id) localStorage.setItem(CURRENT_KEY, id)
  else localStorage.removeItem(CURRENT_KEY)
}

export function loadPassageSize(): number {
  const size = Number(localStorage.getItem(SIZE_KEY))
  return PASSAGE_SIZES.includes(size) ? size : 50
}

export function savePassageSize(size: number) {
  localStorage.setItem(SIZE_KEY, String(size))
}

type Row = {
  id: string
  title: string
  word_count: number
  pos: number
  stats: BookStats | null
  added_at: string
}

const toRow = (book: BookMeta, content: string) => ({
  id: book.id,
  title: book.title,
  word_count: book.wordCount,
  pos: book.pos,
  stats: book.stats ?? null,
  added_at: new Date(book.addedAt).toISOString(),
  content,
})

// The book text is large, so the list leaves it out and getText fetches it per book.
export async function listBooks(): Promise<BookMeta[]> {
  const { data, error } = await supabase
    .from('books')
    .select('id, title, word_count, pos, stats, added_at')
    .order('added_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as Row[]).map((row) => ({
    id: row.id,
    title: row.title,
    wordCount: row.word_count,
    pos: row.pos,
    addedAt: Date.parse(row.added_at),
    stats: row.stats ?? undefined,
  }))
}

export async function getText(id: string): Promise<string> {
  const { data, error } = await supabase.from('books').select('content').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data.content
}

export async function createBook(book: BookMeta, content: string) {
  const { error } = await supabase.from('books').insert(toRow(book, content))
  if (error) throw new Error(error.message)
}

export async function deleteBook(id: string) {
  pending.delete(id)
  const { error } = await supabase.from('books').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// The position changes with every word, so updates are batched and sent about once a second.
type Patch = { pos?: number; stats?: BookStats }

const SAVE_DELAY = 1000
const pending = new Map<string, Patch>()
let timer: ReturnType<typeof setTimeout> | undefined
let syncListener: (error: string | null) => void = () => {}

export function onSyncStatus(listener: (error: string | null) => void) {
  syncListener = listener
}

export function queueUpdate(id: string, patch: Patch) {
  pending.set(id, { ...pending.get(id), ...patch })
  clearTimeout(timer)
  timer = setTimeout(() => void flushUpdates(), SAVE_DELAY)
}

export async function flushUpdates() {
  clearTimeout(timer)
  const batch = [...pending]
  pending.clear()
  let failure: string | null = null
  for (const [id, patch] of batch) {
    const { error } = await supabase.from('books').update(patch).eq('id', id)
    if (error) {
      failure = error.message
      // Keep it for the next attempt, underneath anything queued since.
      pending.set(id, { ...patch, ...pending.get(id) })
    }
  }
  if (batch.length) syncListener(failure)
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushUpdates()
})

// Books saved by earlier versions of the app lived in this browser only (metadata in
// localStorage, text in IndexedDB). Upload them once, then drop the local copies.
const LEGACY_BOOKS_KEY = 'retype.books'

function legacyText(id: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('retype', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('texts')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const get = db.transaction('texts').objectStore('texts').get(id)
      get.onsuccess = () => {
        db.close()
        resolve(get.result)
      }
      get.onerror = () => {
        db.close()
        reject(get.error)
      }
    }
  })
}

export async function migrateLocalBooks() {
  const raw = localStorage.getItem(LEGACY_BOOKS_KEY)
  if (!raw) return
  const books: BookMeta[] = JSON.parse(raw)
  for (const book of books) {
    const content = await legacyText(book.id)
    if (content === undefined) continue
    const { error } = await supabase.from('books').upsert(toRow(book, content))
    if (error) throw new Error(error.message)
  }
  localStorage.removeItem(LEGACY_BOOKS_KEY)
  indexedDB.deleteDatabase('retype')
}
