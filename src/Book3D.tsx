import { useEffect, useRef, useState, type CSSProperties } from 'react'

// Book cloths, as oklch lightness, chroma and hue. A title always gets the same one.
const CLOTHS = [
  [0.34, 0.055, 155], // forest
  [0.3, 0.07, 258], // navy
  [0.32, 0.085, 15], // burgundy
  [0.36, 0.045, 205], // slate teal
  [0.31, 0.065, 320], // plum
  [0.42, 0.03, 250], // slate
]

export function cloth(title: string) {
  let hash = 0
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0
  const [l, c, h] = CLOTHS[hash % CLOTHS.length]
  return { '--cloth': `oklch(${l} ${c} ${h})`, '--cloth-deep': `oklch(${l - 0.07} ${c} ${h})` }
}

// Spine width in px for a book of this many words.
export const thickness = (words: number) => Math.round(Math.min(Math.max(words / 3500, 16), 40))

type Props = {
  title: string
  depth?: number
  cover?: string // image for the front board, in place of stamped cloth
}

// A hardback built from CSS 3D faces: two boards, a spine and the block of pages. Sized by
// --w and --h on an ancestor. Opening one is handed to three.js; see BookScene.
export function Book3D({ title, depth = 24, cover }: Props) {
  return (
    <span className="book3d" style={{ ...cloth(title), '--d': `${depth}px` } as CSSProperties} aria-hidden="true">
      <span className="b-back" />
      <span className="b-spine" />
      <span className="b-edge" />
      {cover ? (
        <span className="b-front pictured" style={{ backgroundImage: `url("${cover}")` }} />
      ) : (
        <span className="b-front">
          <span className="b-title">{title}</span>
        </span>
      )}
    </span>
  )
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Fetch the scene ahead of the first click.
export const preloadOpening = () => void import('./BookScene')

type OpeningProps = {
  title: string
  depth?: number
  cover?: string
  from: DOMRect // where the book sat when it was picked up
  ready: boolean // the page behind is ready to be shown
  onDone: () => void
}

// The book lifts off the shelf, opens, turns its pages until the text is ready, and then the
// view goes into the page.
export function Opening({ title, depth = 24, cover, from, ready, onDone }: OpeningProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The scene has taken over from the copy of the shelf book that stands in until it loads.
  const [drawn, setDrawn] = useState(false)
  const [entering, setEntering] = useState(false)
  const [failed, setFailed] = useState(false)
  const latest = useRef({ ready, onDone })
  latest.current = { ready, onDone }

  useEffect(() => {
    let cancelled = false
    let scene: { dispose: () => void } | undefined
    import('./BookScene')
      .then(({ playOpening }) => {
        if (cancelled) return
        const colours = cloth(title)
        scene = playOpening({
          canvas: canvasRef.current!,
          from,
          title,
          depth,
          cover,
          cloth: colours['--cloth'],
          clothDeep: colours['--cloth-deep'],
          isReady: () => latest.current.ready,
          onFirstFrame: () => setDrawn(true),
          onEnter: () => setEntering(true),
          onDone: () => latest.current.onDone(),
        })
      })
      // No WebGL: the page simply appears.
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      scene?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (failed && ready) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, ready])

  return (
    <div className={`opening${drawn ? ' lifted' : ''}${entering ? ' entering' : ''}`} role="status" aria-label={`Opening ${title}`}>
      <canvas ref={canvasRef} />
      {!drawn && (
        <span
          className="opening-book"
          style={{ left: from.left, top: from.top, '--w': `${from.width}px`, '--h': `${from.height}px` } as CSSProperties}
        >
          <Book3D title={title} depth={depth} cover={cover} />
        </span>
      )}
    </div>
  )
}
