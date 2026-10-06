import { memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

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
}

type State = {
  typed: string[] // what was typed for each word so far
  idx: number // word under the caret
  start: number
  end: number
  keys: number // every keystroke, including ones later corrected
  errors: number
}

type Action =
  | { type: 'char'; char: string; at: number }
  | { type: 'space'; at: number; enter: boolean }
  | { type: 'back'; word: boolean }
  | { type: 'reset' }

const MAX_EXTRA = 10
const INITIAL: State = { typed: [], idx: 0, start: 0, end: 0, keys: 0, errors: 0 }

function reduce(words: string[], paragraphEnds: Set<number>, s: State, a: Action): State {
  if (a.type === 'reset') return INITIAL
  if (s.end) return s
  const target = words[s.idx]
  const cur = s.typed[s.idx] ?? ''
  const last = s.idx === words.length - 1
  const typed = s.typed.slice()

  switch (a.type) {
    case 'char': {
      if (cur.length >= target.length + MAX_EXTRA) return s
      const next = cur + a.char
      typed[s.idx] = next
      return {
        ...s,
        typed,
        start: s.start || a.at,
        end: last && next === target ? a.at : 0,
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
    if (typed === word) correctChars += word.length + (spaced ? 1 : 0)
    for (let j = 0; j < Math.min(word.length, typed.length); j++) {
      if (typed[j] === word[j]) correct++
      else incorrect++
    }
    extra += Math.max(0, typed.length - word.length)
    if (spaced || s.end) missed += Math.max(0, word.length - typed.length)
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
  }
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
  words: string[]
  starts: number[] // index of the first word of each paragraph, beginning with 0
  onProgress: (wordsDone: number) => void
  onFinish: (result: Result) => void
}

export function Typing({ words, starts, onProgress, onFinish }: Props) {
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.isComposing) return
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Tab') {
        e.preventDefault()
        dispatch({ type: 'reset' })
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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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
    if (s.end) onFinish(measure(words, s, s.end))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.end])

  // Line wrapping changes with the viewport width and once the web font arrives.
  useEffect(() => {
    const relayout = () => setLayoutTick((n) => n + 1)
    const observer = new ResizeObserver(relayout)
    observer.observe(viewportRef.current!)
    document.fonts.ready.then(relayout)
    return () => observer.disconnect()
  }, [])

  // Place the caret after the last typed letter and, when the passage is taller than the
  // viewport, keep two lines visible above the active one.
  useLayoutEffect(() => {
    const word = wordsRef.current!.querySelector<HTMLElement>('.word.active')!
    const letter = word.children[Math.max(curLength - 1, 0)] as HTMLElement
    const margin = parseFloat(getComputedStyle(word).marginTop)
    const lineHeight = word.offsetHeight + margin * 2
    const x = letter.offsetLeft + (curLength ? letter.offsetWidth : 0)
    caretRef.current!.style.transform = `translate(${x}px, ${word.offsetTop}px)`
    caretRef.current!.style.height = `${word.offsetHeight}px`
    const overflow = scrollerRef.current!.offsetHeight - viewportRef.current!.clientHeight
    const scroll = Math.max(0, Math.min(word.offsetTop - margin - lineHeight * 2, overflow))
    scrollerRef.current!.style.transform = `translateY(${-scroll}px)`
    viewportRef.current!.classList.toggle('more-above', scroll > 0)
    viewportRef.current!.classList.toggle('more-below', scroll < overflow)
  }, [s.idx, curLength, layoutTick])

  const live = measure(words, s, Date.now())

  return (
    <div className="typing">
      <div className={`live${s.start ? '' : ' idle'}`}>
        <span>
          {s.idx}/{words.length}
        </span>
        <span>{Math.round(live.wpm)} wpm</span>
        <span>{Math.round(live.acc)}%</span>
      </div>
      <div className="viewport" ref={viewportRef}>
        <div className="scroller" ref={scrollerRef}>
          <div className={`caret${running ? '' : ' blink'}`} ref={caretRef} />
          <div className="words" ref={wordsRef}>
            {starts.map((from, p) => {
              const to = starts[p + 1] ?? words.length
              return (
                <div className="paragraph" key={from}>
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
                  {to < words.length && <span className={`enter${s.idx >= to ? ' passed' : ''}`}>↵</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
