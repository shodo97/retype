import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { extract } from './extract'
import {
  PASSAGE_SIZES,
  createBook,
  deleteBook,
  flushUpdates,
  getText,
  listBooks,
  loadCurrent,
  loadPassageSize,
  migrateLocalBooks,
  onSyncStatus,
  queueUpdate,
  saveCurrent,
  savePassageSize,
  type BookMeta,
  type BookStats,
} from './store'
import { supabase } from './supabase'
import { normalize, parseBook, passageAt, passageBounds, type Book } from './text'
import { Typing, type Result } from './Typing'

// Buttons give focus straight back so Space and Enter keep going to the typing test.
const unfocus = (e: MouseEvent<HTMLElement>) => e.currentTarget.blur()

const percent = (book: BookMeta) => (book.wordCount ? (Math.min(book.pos, book.wordCount) / book.wordCount) * 100 : 0)

function formatTime(seconds: number) {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function addResult(stats: BookStats | undefined, result: Result): BookStats {
  return {
    seconds: (stats?.seconds ?? 0) + result.seconds,
    chars: (stats?.chars ?? 0) + (result.wpm * 5 * result.seconds) / 60,
    keys: (stats?.keys ?? 0) + result.keys,
    errors: (stats?.errors ?? 0) + result.mistakes,
  }
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function App() {
  // undefined while the saved session is still being restored
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="app" />
  if (!session) return <SignIn />
  return <Main key={session.user.id} />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="app">
      <header>
        <span className="logo">
          <span className="logo-mark">rt</span>retype
        </span>
      </header>
      <main className="library">
        <form className="sign-in" onSubmit={submit}>
          <input
            type="email"
            placeholder="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="text-button primary" disabled={busy}>
            {busy ? 'signing in…' : 'sign in'}
          </button>
          {error && <p className="error-message">{error}</p>}
        </form>
      </main>
    </div>
  )
}

function Main() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [open, setOpen] = useState<{ id: string; content: Book } | null>(null)
  const [busy, setBusy] = useState<string | null>('loading library…')
  const [error, setError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    onSyncStatus(setSyncError)
    return () => onSyncStatus(() => {})
  }, [])

  async function openBook(id: string) {
    setError(null)
    setBusy('opening…')
    try {
      setOpen({ id, content: parseBook(await getText(id)) })
      saveCurrent(id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // Load the library, then resume the book that was open last time.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await migrateLocalBooks()
        const loaded = await listBooks()
        if (cancelled) return
        setBooks(loaded)
        const current = loadCurrent()
        if (current && loaded.some((b) => b.id === current)) await openBook(current)
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addBook(file: File) {
    setError(null)
    setBusy('reading file…')
    try {
      const { title, text } = await extract(file, setBusy)
      const canonical = normalize(text)
      const content = parseBook(canonical)
      if (!content.words.length) {
        throw new Error('No text found in this file. A scanned PDF has to be run through OCR first.')
      }
      const book: BookMeta = {
        id: crypto.randomUUID(),
        title,
        wordCount: content.words.length,
        pos: 0,
        addedAt: Date.now(),
      }
      setBusy('saving…')
      await createBook(book, canonical)
      setBooks((prev) => [book, ...prev])
      setOpen({ id: book.id, content })
      saveCurrent(book.id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function removeBook(id: string) {
    setError(null)
    try {
      await deleteBook(id)
      setBooks((prev) => prev.filter((b) => b.id !== id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function patchBook(id: string, patch: { pos?: number; stats?: BookStats }) {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
    queueUpdate(id, patch)
  }

  function goHome() {
    setOpen(null)
    saveCurrent(null)
  }

  async function signOut() {
    await flushUpdates()
    await supabase.auth.signOut()
  }

  const book = open && books.find((b) => b.id === open.id)

  return (
    <div className="app">
      <header>
        <button className="logo" onClick={goHome}>
          <span className="logo-mark">rt</span>retype
        </button>
        <nav>
          {syncError && (
            <span className="error-message" title={syncError}>
              progress not saved, retrying
            </span>
          )}
          {book && (
            <button className="text-button" onClick={goHome}>
              library
            </button>
          )}
          <button className="text-button" onClick={signOut}>
            sign out
          </button>
        </nav>
      </header>
      {book && open ? (
        <Reader
          key={book.id}
          book={book}
          content={open.content}
          onPos={(pos) => patchBook(book.id, { pos })}
          onResult={(result) => patchBook(book.id, { stats: addResult(book.stats, result) })}
        />
      ) : (
        <Library books={books} busy={busy} error={error} onFile={addBook} onOpen={openBook} onRemove={removeBook} />
      )}
    </div>
  )
}

function Library(props: {
  books: BookMeta[]
  busy: string | null
  error: string | null
  onFile: (file: File) => void
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { books, busy, error, onFile, onOpen, onRemove } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && !busy) onFile(file)
  }

  return (
    <main className="library">
      <button
        className={`dropzone${dragging ? ' dragging' : ''}`}
        disabled={!!busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {busy ?? (
          <>
            <strong>drop a book here</strong>
            <span>or click to choose a pdf or epub</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      {error && <p className="error-message">{error}</p>}
      {books.length > 0 && (
        <ul className="books">
          {books.map((b) => (
            <li key={b.id}>
              <button className="book" onClick={() => onOpen(b.id)} disabled={!!busy}>
                <span className="book-title">{b.title}</span>
                <span className="book-meta">
                  {b.wordCount.toLocaleString()} words · {percent(b).toFixed(1)}%
                </span>
              </button>
              <button
                className="text-button"
                aria-label={`Remove ${b.title}`}
                onClick={() => {
                  if (confirm(`Remove "${b.title}" and its progress?`)) onRemove(b.id)
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

type ReaderProps = {
  book: BookMeta
  content: Book
  onPos: (pos: number) => void
  onResult: (result: Result) => void
}

function Reader({ book, content, onPos, onResult }: ReaderProps) {
  const { words, starts } = content
  const [size, setSize] = useState(loadPassageSize)
  const [attempt, setAttempt] = useState(0)
  // Result of the passage just finished, with where it started so it can be retyped.
  const [finished, setFinished] = useState<{ result: Result; start: number } | null>(null)

  const bounds = useMemo(() => passageBounds(content, size), [content, size])
  const index = passageAt(bounds, book.pos)
  const start = index < 0 ? words.length : bounds[index]
  const end = index < 0 ? words.length : bounds[index + 1]
  const passage = useMemo(() => words.slice(start, end), [words, start, end])
  // Paragraph starts inside the passage, relative to it.
  const passageStarts = useMemo(
    () => [0, ...starts.filter((i) => i > start && i < end).map((i) => i - start)],
    [starts, start, end],
  )

  function goTo(pos: number) {
    setFinished(null)
    setAttempt((n) => n + 1)
    onPos(pos)
  }

  useEffect(() => {
    if (!finished) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        setFinished(null)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        goTo(finished.start)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  function seek(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const target = passageAt(bounds, Math.floor(fraction * words.length))
    goTo(bounds[target < 0 ? bounds.length - 2 : target])
  }

  return (
    <main className="reader">
      <div className="config">
        <span className="config-label">words</span>
        {PASSAGE_SIZES.map((n) => (
          <button
            key={n}
            className={n === size ? 'active' : ''}
            onClick={(e) => {
              unfocus(e)
              setSize(n)
              savePassageSize(n)
              setFinished(null)
              setAttempt((a) => a + 1)
            }}
          >
            {n}
          </button>
        ))}
        <span className="divider" />
        <button
          disabled={index <= 0 && book.pos < words.length}
          onClick={(e) => {
            unfocus(e)
            goTo(bounds[(index < 0 ? bounds.length - 1 : index) - 1])
          }}
        >
          ‹ prev
        </button>
        <button
          disabled={index < 0}
          onClick={(e) => {
            unfocus(e)
            goTo(end)
          }}
        >
          next ›
        </button>
      </div>

      <div className="stage">
        {finished ? (
          <Results
            result={finished.result}
            onNext={() => setFinished(null)}
            onRedo={() => goTo(finished.start)}
            last={index < 0}
          />
        ) : index < 0 ? (
          <div className="book-done">
            <strong>book finished</strong>
            <span>you typed all {words.length.toLocaleString()} words.</span>
            <button className="text-button" onClick={() => goTo(0)}>
              start again
            </button>
          </div>
        ) : (
          <Typing
            key={`${start}:${end}:${attempt}`}
            words={passage}
            starts={passageStarts}
            onProgress={(done) => onPos(start + done)}
            onFinish={(result) => {
              setFinished({ result, start })
              onPos(end)
              onResult(result)
            }}
          />
        )}
      </div>

      <footer>
        <div className="book-line">
          <span className="book-title">{book.title}</span>
          {book.stats && book.stats.seconds > 0 && (
            <span className="book-stats">
              avg {Math.round(book.stats.chars / 5 / (book.stats.seconds / 60))} wpm ·{' '}
              {Math.floor(((book.stats.keys - book.stats.errors) / Math.max(book.stats.keys, 1)) * 100)}% acc ·{' '}
              {formatDuration(book.stats.seconds)} typed
            </span>
          )}
          <span>
            {Math.min(book.pos, words.length).toLocaleString()} / {words.length.toLocaleString()} words ·{' '}
            {percent(book).toFixed(1)}%
          </span>
        </div>
        <div className="progress" onClick={seek} title="Click to jump to a position in the book">
          <div className="progress-fill" style={{ width: `${percent(book)}%` }} />
        </div>
        <div className="hints">
          <kbd>tab</kbd> restart passage
          {!finished && index >= 0 && (
            <>
              <kbd>enter</kbd> next paragraph
            </>
          )}
          {finished && (
            <>
              <kbd>enter</kbd> next passage
            </>
          )}
        </div>
      </footer>
    </main>
  )
}

function Results(props: { result: Result; last: boolean; onNext: () => void; onRedo: () => void }) {
  const { result, last, onNext, onRedo } = props
  return (
    <div className="results">
      <div className="headline">
        <div className="stat big">
          <span className="label">wpm</span>
          <span className="value">{Math.round(result.wpm)}</span>
        </div>
        <div className="stat big">
          <span className="label">acc</span>
          <span className="value">{Math.floor(result.acc)}%</span>
        </div>
      </div>
      <div className="details">
        <div className="stat">
          <span className="label">raw</span>
          <span className="value">{Math.round(result.raw)}</span>
        </div>
        <div className="stat">
          <span className="label">mistakes</span>
          <span className="value">{result.mistakes}</span>
        </div>
        <div className="stat" title="correct / incorrect / extra / missed">
          <span className="label">characters</span>
          <span className="value">
            {result.correct}/{result.incorrect}/{result.extra}/{result.missed}
          </span>
        </div>
        <div className="stat">
          <span className="label">time</span>
          <span className="value">{formatTime(result.seconds)}</span>
        </div>
      </div>
      <div className="actions">
        <button className="text-button" onClick={onRedo}>
          retype
        </button>
        <button className="text-button primary" onClick={onNext}>
          {last ? 'finish' : 'next passage'}
        </button>
      </div>
    </div>
  )
}
