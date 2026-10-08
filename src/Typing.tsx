import { memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { paragraphAt } from './text'

export type Result = {
  wpm: number
  raw: number
  acc: number
  seconds: number
  keys: number
  mistakes: number
  correct: number
  incorrect: number
  extra: number
  missed: number
  pace: number[] // wpm over the session in equal slices of time; empty for a short one
}

type State = {
  typed: string[] // what was typed for each word so far
  idx: number // word under the caret
  start: number
  end: number
  last: number // time of the latest keystroke
  stamps: number[] // when each word was left
  stopped: boolean // ended by the user rather than by running out of words
  keys: number // every keystroke, including ones later corrected
  errors: number
}

type Action =
  | { type: 'char'; char: string; at: number }
  | { type: 'space'; at: number; enter: boolean }
  | { type: 'back'; word: boolean }
  | { type: 'stop' }

const MAX_EXTRA = 10
const INITIAL: State = {
  typed: [],
  idx: 0,
  start: 0,
  end: 0,
  last: 0,
  stamps: [],
  stopped: false,
  keys: 0,
  errors: 0,
}

// The pace chart gets one point for every SLICE of the session, up to MAX_SLICES.
const SLICE = 10000
const MIN_SLICES = 3
const MAX_SLICES = 30

// Only the words around the caret are rendered. The window moves once every CHUNK words.
const CHUNK = 100
const BEHIND = 100
const AHEAD = 300
const MAX_SNAP = 400

const CONTROLS = 'button, a, [role="slider"]'

// The session ends at the last keystroke, so time spent reaching for the button is not counted.
const stop = (s: State): State => ({ ...s, end: s.last, stopped: true })

function reduce(words: string[], paragraphEnds: Set<number>, s: State, a: Action): State {
  if (s.end) return s
  if (a.type === 'stop') return s.start ? stop(s) : s
  const target = words[s.idx]
  const cur = s.typed[s.idx] ?? ''
  const last = s.idx === words.length - 1
  const typed = s.typed.slice()

  switch (a.type) {
    case 'char': {
      if (cur.length >= target.length + MAX_EXTRA) return s
      const next = cur + a.char
      typed[s.idx] = next
      const finished = last && next === target
      return {
        ...s,
        typed,
        start: s.start || a.at,
        end: finished ? a.at : 0,
        stamps: finished ? stamp(s, a.at) : s.stamps,
        last: a.at,
        keys: s.keys + 1,
        errors: s.errors + (a.char === target[cur.length] ? 0 : 1),
      }
    }
    case 'space': {
      // Enter only moves on from the end of a paragraph; Space works anywhere.
      if (!cur || (a.enter && !paragraphEnds.has(s.idx))) return s
      const skipped = cur.length < target.length
      return {
        ...s,
        idx: last ? s.idx : s.idx + 1,
        end: last ? a.at : 0,
        last: a.at,
        stamps: stamp(s, a.at),
        keys: s.keys + 1,
        errors: s.errors + (skipped ? 1 : 0),
      }
    }
    case 'back': {
      if (cur) {
        typed[s.idx] = a.word ? '' : cur.slice(0, -1)
        return { ...s, typed }
      }
      // Like Monkeytype, only a word with a mistake in it can be re-entered.
      if (s.idx === 0 || s.typed[s.idx - 1] === words[s.idx - 1]) return s
      if (a.word) typed[s.idx - 1] = ''
      return { ...s, typed, idx: s.idx - 1 }
    }
  }
}

function stamp(s: State, at: number): number[] {
  const stamps = s.stamps.slice()
  stamps[s.idx] = at
  return stamps
}

function pace(s: State): number[] {
  const ms = s.end - s.start
  const slices = Math.min(MAX_SLICES, Math.floor(ms / SLICE))
  if (slices < MIN_SLICES) return []
  const chars = new Array<number>(slices).fill(0)
  s.stamps.forEach((at, i) => {
    const slice = Math.min(slices - 1, Math.floor(((at - s.start) / ms) * slices))
    chars[slice] += (s.typed[i] ?? '').length + 1
  })
  return chars.map((n) => n / 5 / (ms / slices / 60000))
}

function measure(words: string[], s: State, now: number): Result {
  let correctChars = 0
  let rawChars = 0
  let correct = 0
  let incorrect = 0
  let extra = 0
  let missed = 0
  for (let i = 0; i <= s.idx; i++) {
    const word = words[i]
    const typed = s.typed[i] ?? ''
    const spaced = i < s.idx
    rawChars += typed.length + (spaced ? 1 : 0)
    // The word under the caret counts for as much of it as has been typed correctly.
    if (spaced ? typed === word : word.startsWith(typed)) correctChars += typed.length + (spaced ? 1 : 0)
    for (let j = 0; j < Math.min(word.length, typed.length); j++) {
      if (typed[j] === word[j]) correct++
      else incorrect++
    }
    extra += Math.max(0, typed.length - word.length)
    if (spaced || (s.end && !s.stopped)) missed += Math.max(0, word.length - typed.length)
  }
  const ms = s.start ? (s.end || now) - s.start : 0
  const minutes = ms / 60000
  return {
    wpm: ms >= 1000 ? correctChars / 5 / minutes : 0,
    raw: ms >= 1000 ? rawChars / 5 / minutes : 0,
    acc: s.keys ? ((s.keys - s.errors) / s.keys) * 100 : 100,
    seconds: ms / 1000,
    keys: s.keys,
    mistakes: s.errors,
    correct,
    incorrect,
    extra,
    missed,
    pace: s.end ? pace(s) : [],
  }
}

const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const Word = memo(function Word({ word, typed, status }: { word: string; typed: string; status: string }) {
  const letters = []
  for (let i = 0; i < Math.max(word.length, typed.length); i++) {
    let cls = ''
    if (i >= word.length) cls = 'extra'
    else if (i < typed.length) cls = typed[i] === word[i] ? 'correct' : 'incorrect'
    letters.push(
      <span key={i} className={cls}>
        {i < word.length ? word[i] : typed[i]}
      </span>,
    )
  }
  const error = status === 'done' && typed !== word
  return <div className={`word ${status}${error ? ' error' : ''}`}>{letters}</div>
})

type Props = {
  words: string[] // everything from where the session starts to the end of the book
  starts: number[] // index of the first word of each paragraph, beginning with 0
  onProgress: (wordsDone: number) => void
  onFinish: (result: Result, wordsDone: number) => void
  // The session was abandoned part-way: the book was closed or the position moved.
  onLeave?: (result: Result) => void
  // The sample on the front door: no end button, and the rest of the page stays in view.
  demo?: boolean
}

export function Typing({ words, starts, onProgress, onFinish, onLeave, demo = false }: Props) {
  const paragraphEnds = useMemo(() => new Set(starts.slice(1).map((i) => i - 1)), [starts])
  const [s, dispatch] = useReducer(
    (state: State, action: Action) => reduce(words, paragraphEnds, state, action),
    INITIAL,
  )
  const [layoutTick, setLayoutTick] = useState(0)
  const [, setClock] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const wordsRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLDivElement>(null)

  const running = s.start > 0 && !s.end
  const curLength = (s.typed[s.idx] ?? '').length

  // Rendered range of words. It starts on a paragraph break when one is close enough, so the
  // lines around the caret do not rewrap when the window moves.
  const anchor = Math.floor(s.idx / CHUNK) * CHUNK
  const [lo, hi] = useMemo(() => {
    const from = Math.max(0, anchor - BEHIND)
    const paragraph = starts[paragraphAt(starts, from)]
    return [from - paragraph <= MAX_SNAP ? paragraph : from, Math.min(words.length, anchor + CHUNK + AHEAD)]
  }, [anchor, starts, words.length])
  const shownRef = useRef(lo)

  const latest = useRef({ s, onLeave })
  latest.current = { s, onLeave }

  useEffect(() => {
    const root = document.documentElement
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.isComposing || e.key === 'Tab') return
      if (e.target instanceof HTMLInputElement) return
      // A focused control keeps the keys that operate it. Any other key goes back to the text.
      const control = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(CONTROLS) : null
      if (control) {
        if (e.key === ' ' || e.key === 'Enter' || e.key.startsWith('Arrow')) return
        control.blur()
      }
      // Typing hides everything but the text; see onMouseMove for how it comes back.
      if (!demo && e.key.length === 1 && !e.ctrlKey) root.dataset.focus = 'on'
      if (e.key === 'Escape') {
        e.preventDefault()
        dispatch({ type: 'stop' })
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        dispatch({ type: 'back', word: e.altKey || e.ctrlKey })
      } else if (e.ctrlKey) {
        return
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        dispatch({ type: 'space', at: Date.now(), enter: e.key === 'Enter' })
      } else if (e.key.length === 1) {
        e.preventDefault()
        dispatch({ type: 'char', char: e.key, at: Date.now() })
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) delete root.dataset.focus
    }
    // A control clicked with the mouse gives focus back, so Space and Enter keep going to the text.
    const onClick = (e: MouseEvent) => {
      const focused = document.activeElement
      if (e.detail && focused instanceof HTMLElement && focused.matches(CONTROLS)) focused.blur()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('click', onClick)
      delete root.dataset.focus
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the live stats moving between keystrokes.
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setClock((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    onProgress(s.idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.idx])

  useEffect(() => {
    if (s.end) onFinish(measure(words, s, s.end), s.stopped ? s.idx : words.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.end])

  // Typing that was never ended still counts towards the book's totals.
  useEffect(
    () => () => {
      const { s, onLeave } = latest.current
      if (s.start && !s.end) onLeave?.(measure(words, stop(s), 0))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Line wrapping changes with the viewport width and once the web font arrives.
  useEffect(() => {
    const relayout = () => setLayoutTick((n) => n + 1)
    const observer = new ResizeObserver(relayout)
    observer.observe(viewportRef.current!)
    document.fonts.ready.then(relayout)
    return () => observer.disconnect()
  }, [])

  // Place the caret after the last typed letter and keep two lines visible above the active one.
  useLayoutEffect(() => {
    const caret = caretRef.current!
    const scroller = scrollerRef.current!
    // When the rendered window moves every offset shifts at once, which must not be animated.
    const jumped = shownRef.current !== lo
    shownRef.current = lo
    if (jumped) caret.style.transition = scroller.style.transition = 'none'
    const word = wordsRef.current!.querySelector<HTMLElement>('.word.active')!
    const letter = word.children[Math.max(curLength - 1, 0)] as HTMLElement
    const margin = parseFloat(getComputedStyle(word).marginTop)
    const lineHeight = word.offsetHeight + margin * 2
    const x = letter.offsetLeft + (curLength ? letter.offsetWidth : 0)
    caret.style.transform = `translate(${x}px, ${word.offsetTop}px)`
    caret.style.height = `${word.offsetHeight}px`
    const overflow = scroller.offsetHeight - viewportRef.current!.clientHeight
    const scroll = Math.max(0, Math.min(word.offsetTop - margin - lineHeight * 2, overflow))
    scroller.style.transform = `translateY(${-scroll}px)`
    viewportRef.current!.classList.toggle('more-above', scroll > 0)
    viewportRef.current!.classList.toggle('more-below', scroll < overflow || hi < words.length)
    if (jumped) {
      void scroller.offsetHeight
      caret.style.transition = scroller.style.transition = ''
    }
  }, [s.idx, curLength, layoutTick, lo, hi, words.length])

  const live = measure(words, s, Date.now())

  const paragraphs = []
  for (let p = paragraphAt(starts, lo); p < starts.length && starts[p] < hi; p++) {
    const next = starts[p + 1] ?? words.length
    const from = Math.max(starts[p], lo)
    const to = Math.min(next, hi)
    paragraphs.push(
      <div className="paragraph" key={starts[p]}>
        {words.slice(from, to).map((word, j) => {
          const i = from + j
          return (
            <Word
              key={i}
              word={word}
              typed={s.typed[i] ?? ''}
              status={i < s.idx ? 'done' : i === s.idx ? 'active' : 'todo'}
            />
          )
        })}
        {to === next && to < words.length && <span className={`enter${s.idx >= to ? ' passed' : ''}`}>¶</span>}
      </div>,
    )
  }

  return (
    <div className={`typing${demo ? ' demo' : ''}`}>
      <div className="viewport" ref={viewportRef} aria-label="Text to type">
        <div className="scroller" ref={scrollerRef}>
          <div className={`caret${running ? '' : ' blink'}`} ref={caretRef} />
          <div className="words" ref={wordsRef}>
            {paragraphs}
          </div>
        </div>
      </div>
      <div className="typing-foot">
        {s.start ? (
          // Words and time with the book; speed and accuracy wait for the end of the session.
          <p className="live">
            <span>{s.idx.toLocaleString()} words</span>
            <span>{formatClock(live.seconds)}</span>
          </p>
        ) : (
          <p className="live">Start typing when you are ready.</p>
        )}
        {!demo && (
          <button className="button quiet chrome" disabled={!s.start} onClick={() => dispatch({ type: 'stop' })}>
            End session <kbd>esc</kbd>
          </button>
        )}
      </div>
    </div>
  )
}
