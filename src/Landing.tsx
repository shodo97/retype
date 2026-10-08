import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Book3D, Opening, preloadOpening, reducedMotion } from './Book3D'
import { useCover } from './covers'
import type { Experience, HudState } from './experience/core'
import { supabase } from './supabase'
import { useTheme } from './theme'
import { Typing, type Result } from './Typing'
import { ThemeToggle, Wordmark } from './Wordmark'

const SAMPLE =
  'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.'.split(
    ' ',
  )
const SAMPLE_STARTS = [0]
const SAMPLE_TITLE = 'Walden'

const NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

const FONTS = [
  '500 100px "Literata Variable"',
  'italic 500 100px "Literata Variable"',
  '400 24px "Literata Variable"',
  'italic 400 24px "Literata Variable"',
]

// The front door: a six-act night, performed as much as read. See PRODUCT.md for the script.
export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [trying, setTrying] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const [opening, setOpening] = useState<DOMRect | null>(null)
  // No WebGL, or reduced motion: the still, readable version of the same argument.
  const [still, setStill] = useState(() => reducedMotion())
  const [hud, setHud] = useState<HudState | null>(null)
  const [audioOn, setAudioOn] = useState(true)
  const cover = useCover('sample', 'Walden Henry David Thoreau')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stillBookRef = useRef<HTMLSpanElement>(null)
  const experienceRef = useRef<Experience | null>(null)

  useEffect(preloadOpening, [])

  useEffect(() => {
    if (trying || still) return
    let cancelled = false
    let experience: Experience | undefined
    void Promise.all([...FONTS.map((f) => document.fonts.load(f)), import('./experience/core')])
      .then(([, , , , mod]) => {
        const { createExperience } = mod as typeof import('./experience/core')
        if (cancelled || !canvasRef.current) return
        experience = createExperience({ canvas: canvasRef.current, onHud: setHud })
        experienceRef.current = experience
      })
      .catch(() => setStill(true))
    return () => {
      cancelled = true
      experience?.dispose()
      experienceRef.current = null
      setHud(null)
    }
  }, [trying, still])

  function openSample() {
    setResult(null)
    setAttempt((n) => n + 1)
    if (reducedMotion()) return setTrying(true)
    const rect = experienceRef.current?.bookRect() ?? stillBookRef.current?.getBoundingClientRect()
    if (!rect || rect.width < 10 || rect.bottom < 0 || rect.top > innerHeight) return setTrying(true)
    experienceRef.current?.setHidden(true)
    setOpening(rect)
  }

  function again() {
    setResult(null)
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    if (!result) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target instanceof HTMLElement && e.target.closest('button'))) return
      e.preventDefault()
      again()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [result])

  function closeBook() {
    setTrying(false)
  }

  if (trying) {
    return (
      <div className="app">
        <header className="masthead">
          <button className="home" onClick={closeBook} aria-label="retype, back to the front page">
            <Wordmark />
          </button>
          <nav>
            <button className="link" onClick={closeBook}>
              Close the book
            </button>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </nav>
        </header>
        <main className="reader">
          <p className="running-head">
            Henry David Thoreau · <cite>{SAMPLE_TITLE}</cite>
          </p>
          <div className="stage">
            {result ? (
              <section className="results">
                <h1 className="eyebrow">A sentence, typed</h1>
                <p className="verdict">
                  <b>{SAMPLE.length} words</b>, and every letter of them went through your hands. A whole book works
                  the same way, and remembers where you stopped.
                </p>
                <p className="fine">
                  {Math.round(result.wpm)} words a minute, {Math.floor(result.acc)}% accuracy, for the record.
                </p>
                <div className="actions">
                  <button className="button primary" onClick={closeBook}>
                    Sign in to bring your own
                  </button>
                  <button className="button quiet" onClick={again}>
                    Type it again <kbd>enter</kbd>
                  </button>
                </div>
              </section>
            ) : (
              <Typing
                demo
                key={attempt}
                words={SAMPLE}
                starts={SAMPLE_STARTS}
                onProgress={() => {}}
                onFinish={(r) => setResult(r)}
              />
            )}
          </div>
        </main>
      </div>
    )
  }

  if (still) {
    return (
      <>
        <StillLanding cover={cover} bookRef={stillBookRef} onOpen={openSample} />
        {opening && (
          <Opening
            title={SAMPLE_TITLE}
            depth={34}
            cover={cover}
            from={opening}
            ready
            onDone={() => {
              setOpening(null)
              setTrying(true)
            }}
          />
        )}
      </>
    )
  }

  const gate = hud?.gate ?? null

  return (
    <>
      <div className="nocturne night-stage">
        <canvas className="night-canvas" ref={canvasRef} aria-label="retype, a six-act case for reading by typing" role="img" />
        <div className="grain" aria-hidden="true" />

        <header className="masthead night-mast">
          <Wordmark />
          <nav>
            <button
              className="link"
              onClick={() => setAudioOn(experienceRef.current?.toggleAudio() ?? !audioOn)}
              aria-pressed={audioOn}
            >
              Sound {audioOn ? 'on' : 'off'}
            </button>
            <button className="link" onClick={() => experienceRef.current?.jumpToDesk()}>
              Sign in
            </button>
          </nav>
        </header>

        {hud && (
          <div className="hud" aria-hidden={false}>
            <div className="ruler" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.progress * 100)}>
              <div className="ruler-line">
                <div className="ruler-fill" style={{ width: `${hud.progress * 100}%` }} />
              </div>
              <ol className="ruler-acts">
                {NUMERALS.map((n, i) => (
                  <li key={i} className={i === hud.act ? 'now' : i < hud.act ? 'past' : ''}>
                    {n || '·'}
                  </li>
                ))}
              </ol>
              <p className="ruler-title">{hud.actTitle}</p>
            </div>

            {hud.kept > 0 && (
              <p className="kept" aria-live="polite">
                {hud.kept} {hud.kept === 1 ? 'word' : 'words'} kept
              </p>
            )}

            {gate && (
              <div className={`gate${gate.missed ? ' missed' : ''}`} role="status">
                {gate.kind === 'hold' ? (
                  <>
                    <svg className="gate-ring" viewBox="0 0 72 72" aria-hidden="true">
                      <circle className="gate-ring-track" cx="36" cy="36" r="31" />
                      <circle
                        className="gate-ring-fill"
                        cx="36"
                        cy="36"
                        r="31"
                        style={{ strokeDashoffset: `${195 * (1 - gate.progress)}` }}
                      />
                    </svg>
                    <p className="gate-prompt">{gate.prompt}</p>
                    <p className="gate-hint">{gate.hint}</p>
                  </>
                ) : (
                  <>
                    <p className="gate-prompt">{gate.prompt}</p>
                    {gate.target && gate.kind === 'line' && (
                      <p className="gate-word" aria-label={`Type: ${gate.target}`}>
                        {[...gate.target].map((ch, i) => (
                          <span key={i} className={i < gate.typed ? 'hit' : ''}>
                            {ch}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="gate-hint">or press enter to watch</p>
                  </>
                )}
                <button className="link gate-skip" onClick={() => experienceRef.current?.skipGate()}>
                  skip
                </button>
              </div>
            )}

            {hud.caption && (
              <p className="night-caption" key={hud.caption}>
                {hud.caption}
              </p>
            )}

            {hud.atDesk && !gate && (
              <div className="desk-panel">
                <button className="button primary open-cta" onClick={openSample}>
                  Open it and type a page
                </button>
                <p className="fine">
                  {hud.kept > 0
                    ? `${hud.kept} words kept tonight. The next ones could be a book's.`
                    : 'A page of Walden is waiting.'}
                </p>
                <SignIn />
              </div>
            )}
          </div>
        )}
      </div>
      {opening && (
        <Opening
          title={SAMPLE_TITLE}
          depth={34}
          cover={cover}
          from={opening}
          ready
          onDone={() => {
            setOpening(null)
            setTrying(true)
          }}
        />
      )}
    </>
  )
}

// The same six acts, printed flat: for readers who asked for less motion, and for machines
// that cannot draw the night.
function StillLanding(props: {
  cover?: string
  bookRef: React.RefObject<HTMLSpanElement | null>
  onOpen: () => void
}) {
  return (
    <div className="nocturne still">
      <div className="grain" aria-hidden="true" />
      <header className="masthead night-mast">
        <Wordmark />
        <nav>
          <button className="link" onClick={() => document.getElementById('sign-in-email')?.focus()}>
            Sign in
          </button>
        </nav>
      </header>
      <main className="still-main">
        <section className="still-hero">
          <div>
            <p className="eyebrow">A slower way to read</p>
            <h1>Read with your hands.</h1>
            <p className="lede">
              retype sets a book you love on the page, and you type it through, word by word. Not to type faster.
              To read deeper.
            </p>
          </div>
          <span className="still-book" ref={props.bookRef} aria-hidden="true">
            <Book3D title={SAMPLE_TITLE} depth={34} cover={props.cover} />
          </span>
        </section>
        <ol className="still-acts">
          <li>
            <h2>The flood</h2>
            <p>You will read a hundred thousand words today. Feeds, captions, summaries of summaries. How much of
            yesterday's did you keep?</p>
          </li>
          <li>
            <h2>The vanishing</h2>
            <p>A beautiful page, read silently, is almost gone by tomorrow. What you hold, stays.</p>
          </li>
          <li>
            <h2>The hands</h2>
            <p>What the hand writes, the mind keeps. For a thousand years, copying a text was how a text was
            learned by heart. A copied page is read twice.</p>
          </li>
          <li>
            <h2>The book</h2>
            <p>Bring a PDF, an EPUB or plain text. retype lays it on the desk, keeps your place to the word, and
            never shows a words-per-minute while you read.</p>
          </li>
          <li>
            <h2>Into the page</h2>
            <p>Twenty minutes a night. A book a season. Every word through your hands.</p>
          </li>
        </ol>
        <section className="still-desk">
          <h2>The book is on the desk.</h2>
          <button className="button primary open-cta" onClick={props.onOpen}>
            Open it and type a page
          </button>
          <SignIn />
        </section>
      </main>
    </div>
  )
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
    <form className="sign-in" onSubmit={submit} aria-labelledby="sign-in-title">
      <h2 id="sign-in-title">Already have a shelf?</h2>
      <label>
        Email
        <input
          id="sign-in-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
        />
      </label>
      {error && (
        <p className="alert" role="alert">
          {error}. Check both fields and try again.
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="fine">Accounts are by invitation for now.</p>
    </form>
  )
}
