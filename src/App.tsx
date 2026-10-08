import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import { Book3D, Opening, preloadOpening, reducedMotion, thickness } from './Book3D'
import { coverFromFile, forgetCover, loadCover, saveCover, useCover } from './covers'
import { extract } from './extract'
import { Landing } from './Landing'
import {
  createBook,
  deleteBook,
  flushUpdates,
  getText,
  listBooks,
  loadCurrent,
  loadLast,
  migrateLocalBooks,
  onSyncStatus,
  queueUpdate,
  saveCurrent,
  type BookMeta,
  type BookStats,
} from './store'
import { supabase } from './supabase'
import { normalize, paragraphAt, parseBook, type Book } from './text'
import { useTheme } from './theme'
import { Typing, type Result } from './Typing'
import { ThemeToggle, Wordmark } from './Wordmark'

const percent = (book: BookMeta) => (book.wordCount ? (Math.min(book.pos, book.wordCount) / book.wordCount) * 100 : 0)

function progressLabel(book: BookMeta) {
  if (book.pos <= 0) return 'Not started'
  if (book.pos >= book.wordCount) return 'Finished'
  return `${percent(book).toFixed(1)}%`
}

function formatSpan(seconds: number) {
  const s = Math.round(seconds)
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// Lifetime figures for a book, or nothing before its first session.
function statsLine(stats: BookStats | undefined) {
  if (!stats || stats.seconds <= 0) return null
  const wpm = Math.round(stats.chars / 5 / (stats.seconds / 60))
  const acc = Math.floor(((stats.keys - stats.errors) / Math.max(stats.keys, 1)) * 100)
  return `avg ${wpm} wpm · ${acc}% accuracy · ${formatDuration(stats.seconds)} typed`
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
  if (!session) return <Landing />
  return <Main key={session.user.id} />
}

function Main() {
  const [theme, toggleTheme] = useTheme()
  const [books, setBooks] = useState<BookMeta[]>([])
  const [open, setOpen] = useState<{ id: string; content: Book } | null>(null)
  // False until the library has loaded and any book left open last time is back on screen.
  const [ready, setReady] = useState(false)
  // Progress of a file being added.
  const [busy, setBusy] = useState<string | null>(null)
  // The book being fetched. With `from` it is also being lifted off the shelf and opened.
  const [opening, setOpening] = useState<{ id: string; from?: DOMRect } | null>(null)
  const [fetched, setFetched] = useState<Book | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    onSyncStatus(setSyncError)
    return () => onSyncStatus(() => {})
  }, [])

  function show(id: string, content: Book) {
    setOpen({ id, content })
    saveCurrent(id)
    setOpening(null)
    setFetched(null)
  }

  // `from` is where the book sits on the shelf; without it the page simply appears.
  async function openBook(id: string, from?: DOMRect) {
    const animate = !!from && !reducedMotion()
    setError(null)
    setFetched(null)
    setOpening({ id, from: animate ? from : undefined })
    try {
      const content = parseBook(await getText(id))
      // An animated opening shows the page itself, once the pages have turned.
      if (animate) setFetched(content)
      else show(id, content)
    } catch (e) {
      setError(errorMessage(e))
      setOpening(null)
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
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addBook(file: File) {
    setError(null)
    setBusy('Reading the file')
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
      setBusy('Saving to your library')
      await createBook(book, canonical)
      // The cover is a nicety: the book is added whether or not one can be found in the file.
      void coverFromFile(file)
        .then((cover) => cover && saveCover(book.id, cover))
        .catch(() => {})
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
      forgetCover(id)
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
      <header className="masthead chrome">
        <button className="home" onClick={goHome} aria-label="retype, back to the library">
          <Wordmark />
        </button>
        <nav>
          {syncError && (
            <span className="sync-error" role="status" title={syncError}>
              Progress not saved. Retrying.
            </span>
          )}
          {book && (
            <button className="link" onClick={goHome}>
              Library
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button className="link" onClick={signOut}>
            Sign out
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
          onHome={goHome}
        />
      ) : ready ? (
        <Library
          books={books}
          busy={busy}
          opening={opening?.id ?? null}
          error={error}
          onFile={addBook}
          onOpen={openBook}
          onRemove={removeBook}
        />
      ) : (
        <main className="library" aria-busy="true" aria-label="Loading your library">
          <div className="skeleton">
            <span />
            <span />
            <span />
          </div>
        </main>
      )}
      {opening?.from && (
        <Opening
          title={books.find((b) => b.id === opening.id)?.title ?? ''}
          depth={thickness(books.find((b) => b.id === opening.id)?.wordCount ?? 0)}
          cover={loadCover(opening.id) || undefined}
          from={opening.from}
          ready={!!fetched}
          onDone={() => fetched && show(opening.id, fetched)}
        />
      )}
    </div>
  )
}

function Library(props: {
  books: BookMeta[]
  busy: string | null
  opening: string | null
  error: string | null
  onFile: (file: File) => void
  onOpen: (id: string, from?: DOMRect) => void
  onRemove: (id: string) => void
}) {
  const { books, busy, opening, error, onFile, onOpen, onRemove } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // Book whose removal is waiting to be confirmed.
  const [removing, setRemoving] = useState<string | null>(null)
  const locked = !!busy || !!opening

  const coverInputRef = useRef<HTMLInputElement>(null)
  const coverFor = useRef<string | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)

  useEffect(preloadOpening, [])

  const latest = useRef({ locked, onFile })
  latest.current = { locked, onFile }

  // A file can be dropped anywhere on the page.
  useEffect(() => {
    let depth = 0
    const hasFile = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFile(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFile(e)) return
      if (--depth <= 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFile(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFile(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file && !latest.current.locked) latest.current.onFile(file)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const last = useMemo(loadLast, [])
  const current = books.find((b) => b.id === last && b.pos < b.wordCount)
  const shelf = books.filter((b) => b !== current)

  // Opens a book from where it sits on the shelf.
  const pick = (id: string) => onOpen(id, document.getElementById(`book-${id}`)?.getBoundingClientRect())

  const volume = (b: BookMeta, large = false) => (
    <Volume book={b} large={large} hidden={opening === b.id} disabled={locked} onPick={() => pick(b.id)} />
  )

  // Remove, and a way to give the book a cover from a picture or from its own file.
  const upkeep = (b: BookMeta) => (
    <p className="upkeep">
      <button
        className="link"
        aria-label={`Change the cover of ${b.title}`}
        onClick={() => {
          coverFor.current = b.id
          coverInputRef.current?.click()
        }}
      >
        Change cover
      </button>
      <button className="link" aria-label={`Remove ${b.title}`} onClick={() => setRemoving(b.id)}>
        Remove
      </button>
    </p>
  )

  async function changeCover(file: File) {
    const id = coverFor.current
    if (!id) return
    setCoverError(null)
    try {
      const cover = await coverFromFile(file)
      if (cover) saveCover(id, cover)
      else setCoverError('No cover found in that file. Choose a picture, or the PDF or EPUB of the book.')
    } catch {
      setCoverError('That file could not be read as a cover. Choose a picture, or the PDF or EPUB of the book.')
    }
  }

  const confirmRemove = (b: BookMeta) => (
    <p className="confirm">
      <span>Remove this book and its progress?</span>
      <button
        className="link danger"
        autoFocus
        onClick={() => {
          setRemoving(null)
          onRemove(b.id)
        }}
      >
        Remove
      </button>
      <button className="link" onClick={() => setRemoving(null)}>
        Keep
      </button>
    </p>
  )

  const addButton = (
    <button className="button" disabled={locked} onClick={() => inputRef.current?.click()}>
      Add a book
    </button>
  )

  return (
    <main className="library">
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

      {busy && (
        <p className="status" role="status">
          {busy}
        </p>
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*,.pdf,.epub,application/pdf,application/epub+zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void changeCover(file)
          e.target.value = ''
        }}
      />
      {(error ?? coverError) && (
        <p className="alert" role="alert">
          {error ?? coverError}
        </p>
      )}

      {books.length === 0 ? (
        <section className="empty">
          <p className="eyebrow">Your library</p>
          <h1>Nothing on the shelf yet.</h1>
          <p className="lede">
            Add a book and retype will set it out for typing, from the first word to the last. PDF, EPUB and plain
            text all work. A scanned PDF needs OCR first.
          </p>
          {addButton}
          <p className="fine">Or drop a file anywhere on this page.</p>
        </section>
      ) : (
        <>
          {current && (
            <section className="current" aria-labelledby="current-title">
              {volume(current, true)}
              <div className="current-text">
                <p className="eyebrow">{current.pos > 0 ? 'Continue' : 'Up next'}</p>
                <h1 id="current-title">{current.title}</h1>
                <div className="rule" aria-hidden="true">
                  <div style={{ width: `${percent(current)}%` }} />
                </div>
                <p className="current-meta">
                  <span>
                    {Math.min(current.pos, current.wordCount).toLocaleString()} of{' '}
                    {current.wordCount.toLocaleString()} words
                  </span>
                  {statsLine(current.stats) && <span>{statsLine(current.stats)}</span>}
                </p>
                {removing === current.id ? (
                  confirmRemove(current)
                ) : (
                  <div className="actions">
                    <button className="button primary" disabled={locked} onClick={() => pick(current.id)}>
                      {current.pos > 0 ? 'Continue typing' : 'Start typing'}
                    </button>
                    {upkeep(current)}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="shelf" aria-labelledby="shelf-title">
            <header>
              <h2 className="eyebrow" id="shelf-title">
                {current ? 'Also on the shelf' : 'Your library'}
              </h2>
              {addButton}
            </header>
            {shelf.length > 0 && (
              <ol className="volumes">
                {shelf.map((b) => (
                  <li key={b.id} className="volume">
                    {volume(b)}
                    <p className="volume-title">{b.title}</p>
                    <p className="volume-meta">
                      {progressLabel(b)} · {b.wordCount.toLocaleString()} words
                    </p>
                    {statsLine(b.stats) && <p className="volume-meta">{statsLine(b.stats)}</p>}
                    {removing === b.id ? (
                      confirmRemove(b)
                    ) : (
                      upkeep(b)
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="fine">Drop a PDF, EPUB or text file anywhere on this page to add it.</p>
          </section>
        </>
      )}

      {dragging && (
        <div className="drop-veil" aria-hidden="true">
          <p>{locked ? 'One book at a time. This one can wait.' : 'Drop it to add it to your library.'}</p>
        </div>
      )}
    </main>
  )
}

function Volume(props: { book: BookMeta; large: boolean; hidden: boolean; disabled: boolean; onPick: () => void }) {
  const { book, large, hidden, disabled, onPick } = props
  const cover = useCover(book.id, book.title)
  return (
    <button className="volume-open" disabled={disabled} onClick={onPick} aria-label={`Open ${book.title}`}>
      <span
        className={`book-slot${large ? ' large' : ''}`}
        id={`book-${book.id}`}
        style={hidden ? { visibility: 'hidden' } : undefined}
      >
        <Book3D title={book.title} depth={thickness(book.wordCount)} cover={cover} />
      </span>
    </button>
  )
}

type ReaderProps = {
  book: BookMeta
  content: Book
  onPos: (pos: number) => void
  onResult: (result: Result) => void
  onHome: () => void
}

function Reader({ book, content, onPos, onResult, onHome }: ReaderProps) {
  const { words, starts } = content
  // Where the current session began. Typing runs on from here until it is ended.
  const [from, setFrom] = useState(book.pos)
  const [attempt, setAttempt] = useState(0)
  // Result of the session just ended, with its range so it can be retyped or continued.
  const [finished, setFinished] = useState<{ result: Result; start: number; end: number } | null>(null)
  // Where along the progress rule the pointer is, as a fraction.
  const [hover, setHover] = useState<number | null>(null)

  const done = from >= words.length
  const rest = useMemo(() => words.slice(from), [words, from])
  // Paragraph starts from here on, relative to the session.
  const restStarts = useMemo(() => [0, ...starts.filter((i) => i > from).map((i) => i - from)], [starts, from])

  function goTo(pos: number) {
    setFinished(null)
    setFrom(pos)
    setAttempt((n) => n + 1)
    onPos(pos)
  }

  useEffect(() => {
    if (!finished) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('button')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        goTo(finished.end)
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        goTo(finished.start)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  const fraction = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
  }

  // Jumps land on the start of a paragraph.
  function seek(e: MouseEvent<HTMLDivElement>) {
    const target = Math.min(Math.floor(fraction(e) * words.length), words.length - 1)
    goTo(starts[paragraphAt(starts, target)])
  }

  // Arrow keys on the progress rule step back and forth a paragraph at a time.
  function step(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const pos = Math.min(book.pos, words.length - 1)
    const p = paragraphAt(starts, pos)
    if (e.key === 'ArrowRight') {
      if (p + 1 < starts.length) goTo(starts[p + 1])
    } else goTo(book.pos > starts[p] ? starts[p] : starts[Math.max(p - 1, 0)])
  }

  const typedWords = Math.min(book.pos, words.length)
  const stats = statsLine(book.stats)

  return (
    <main className="reader">
      <p className="running-head chrome">{book.title}</p>

      <div className="stage">
        {finished ? (
          <Results
            result={finished.result}
            words={finished.end - finished.start}
            last={finished.end >= words.length}
            onNext={() => goTo(finished.end)}
            onRedo={() => goTo(finished.start)}
          />
        ) : done ? (
          <section className="finis">
            <h1>Finis</h1>
            <p className="lede">
              You typed all {words.length.toLocaleString()} words of <cite>{book.title}</cite>.
            </p>
            {stats && <p className="fine">{stats}</p>}
            <div className="actions">
              <button className="button primary" onClick={onHome}>
                Back to the library
              </button>
              <button className="button quiet" onClick={() => goTo(0)}>
                Type it again
              </button>
            </div>
          </section>
        ) : (
          <Typing
            key={`${from}:${attempt}`}
            words={rest}
            starts={restStarts}
            onProgress={(typed) => onPos(from + typed)}
            onFinish={(result, typed) => {
              setFinished({ result, start: from, end: from + typed })
              onPos(from + typed)
              onResult(result)
            }}
            onLeave={onResult}
          />
        )}
      </div>

      <footer className="reader-foot">
        <div
          className="progress"
          role="slider"
          tabIndex={0}
          aria-label="Position in the book"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent(book))}
          aria-valuetext={`${percent(book).toFixed(1)}% of the book`}
          onClick={seek}
          onKeyDown={step}
          onMouseMove={(e) => setHover(fraction(e))}
          onMouseLeave={() => setHover(null)}
        >
          <div className="progress-fill" style={{ width: `${percent(book)}%` }} />
          {hover !== null && (
            <span className="progress-at" style={{ left: `${hover * 100}%` }}>
              Jump to {Math.round(hover * 100)}%
            </span>
          )}
        </div>
        <div className="foot-line chrome">
          <span>
            {typedWords.toLocaleString()} of {words.length.toLocaleString()} words · {percent(book).toFixed(1)}%
          </span>
          {stats && <span>{stats}</span>}
        </div>
        <p className="hints chrome">
          {finished ? (
            <>
              <span>
                <kbd>enter</kbd> {finished.end >= words.length ? 'finish' : 'continue'}
              </span>
              <span>
                <kbd>R</kbd> retype
              </span>
            </>
          ) : (
            !done && (
              <>
                <span>
                  <kbd>enter</kbd> at each ¶
                </span>
                <span>
                  <kbd>esc</kbd> end the session
                </span>
              </>
            )
          )}
        </p>
      </footer>
    </main>
  )
}

function Pace({ values }: { values: number[] }) {
  const top = Math.max(...values) * 1.1 || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${(1 - v / top) * 100}`).join(' ')
  const low = Math.round(Math.min(...values))
  const high = Math.round(Math.max(...values))
  return (
    <figure className="pace">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Pace over the session, between ${low} and ${high} words a minute`}
      >
        <polyline points={points} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>Pace, start to finish</span>
        <span>
          {low} to {high} wpm
        </span>
      </figcaption>
    </figure>
  )
}

function Results(props: { result: Result; words: number; last: boolean; onNext: () => void; onRedo: () => void }) {
  const { result, words, last, onNext, onRedo } = props
  return (
    <section className="results" aria-labelledby="results-title">
      <h1 className="eyebrow" id="results-title">
        Session
      </h1>
      <p className="verdict">
        <b>{words.toLocaleString()}</b> {words === 1 ? 'word' : 'words'} in <b>{formatSpan(result.seconds)}</b>.
        Every one of them passed through your hands.
      </p>
      {result.pace.length > 0 && <Pace values={result.pace} />}
      <dl className="figures">
        <div>
          <dt>Speed</dt>
          <dd>
            {Math.round(result.wpm)} wpm · {Math.round(result.raw)} raw
          </dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>
            {Math.floor(result.acc)}% · {result.mistakes.toLocaleString()}{' '}
            {result.mistakes === 1 ? 'mistake' : 'mistakes'}
          </dd>
        </div>
        <div>
          <dt>Characters</dt>
          <dd>
            {result.correct.toLocaleString()} right, {result.incorrect} wrong, {result.extra} extra, {result.missed}{' '}
            missed
          </dd>
        </div>
      </dl>
      <div className="actions">
        <button className="button primary" onClick={onNext}>
          {last ? 'Finish' : 'Continue'} <kbd>enter</kbd>
        </button>
        <button className="button quiet" onClick={onRedo}>
          Retype <kbd>R</kbd>
        </button>
      </div>
    </section>
  )
}
