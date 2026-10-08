// The orchestrator of the landing experience: one renderer, one eased scroll value, a row
// of acts that read it, and gates that stop it until the reader performs. The DOM above the
// canvas only mirrors what happens here.
import * as THREE from 'three'
import { createAmbience, type Ambience } from './audio'
import { buildActs } from './acts'

export type GateKind = 'type' | 'hold' | 'line'

export type GateState = {
  kind: GateKind
  prompt: string
  hint: string
  target?: string
  typed: number
  progress: number
  missed: boolean
}

export type HudState = {
  act: number
  actTitle: string
  kept: number
  caption: string | null
  gate: GateState | null
  atDesk: boolean
  progress: number
}

export type Ctx = {
  scene: THREE.Scene
  root: THREE.Group
  width(): number
  height(): number
  audio: Ambience
  addKept(n: number): void
  setBookRect(provider: (() => DOMRect) | null): void
  setHiddenHandler(handler: ((hidden: boolean) => void) | null): void
  lamp: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  ambient: THREE.AmbientLight
  touch: boolean
}

export type Act = {
  title: string
  span: [number, number]
  gateAt?: number // global progress where this act's gate stops the scroll
  gate?: {
    kind: GateKind
    prompt: string
    target?: string
    onKey?(correct: boolean, index: number, ctx: Ctx): void
    onProgress?(p: number, ctx: Ctx): void
    onComplete?(ctx: Ctx): void
  }
  init(ctx: Ctx): void
  scrub(local: number, ctx: Ctx, global: number): void
  update(dt: number, time: number, ctx: Ctx): void
  caption?(local: number): string | null
  setVisible(visible: boolean): void
  dispose(): void
}

export type Experience = {
  wake(): void // first user gesture arrived from the DOM side
  bookRect(): DOMRect | null
  setHidden(hidden: boolean): void
  toggleAudio(): boolean
  skipGate(): void
  jumpToDesk(): void // for returning readers: past every gate, straight to the sign-in
  dispose(): void
}

const TOTAL_PX = 14000
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

export const isTouchOnly = () => matchMedia('(hover: none), (pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches

export function createExperience(options: { canvas: HTMLCanvasElement; onHud: (hud: HudState) => void }): Experience {
  let W = innerWidth
  let H = innerHeight
  const touch = isTouchOnly()

  const renderer = new THREE.WebGLRenderer({ canvas: options.canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(W, H, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const fov = 30
  let distance = H / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)))
  const camera = new THREE.PerspectiveCamera(fov, W / H, 10, distance * 6)
  camera.position.z = distance

  const scene = new THREE.Scene()
  const root = new THREE.Group()
  scene.add(root)

  const ambient = new THREE.AmbientLight(0xffeedd, 0.45)
  scene.add(ambient)
  const lamp = new THREE.DirectionalLight(0xffd9a6, 0.7)
  lamp.position.set(-W * 0.35, H * 0.7, distance * 0.9)
  lamp.castShadow = true
  lamp.shadow.mapSize.set(1024, 1024)
  const reach = Math.max(W, H)
  Object.assign(lamp.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: distance * 4 })
  lamp.shadow.bias = -0.0004
  lamp.shadow.normalBias = 1.5
  lamp.shadow.radius = 7
  scene.add(lamp)
  const fill = new THREE.DirectionalLight(0x93a8c7, 0.45)
  fill.position.set(W * 0.5, -H * 0.1, distance * 0.4)
  scene.add(fill)

  const audio = createAmbience()

  // ---- the HUD mirror ----
  const hud: HudState = { act: 0, actTitle: '', kept: 0, caption: null, gate: null, atDesk: false, progress: 0 }
  let hudDirty = true
  const push = () => {
    hudDirty = true
  }

  // ---- context handed to the acts ----
  let rectProvider: (() => DOMRect) | null = null
  let hiddenHandler: ((hidden: boolean) => void) | null = null
  const ctx: Ctx = {
    scene,
    root,
    width: () => W,
    height: () => H,
    audio,
    addKept(n) {
      hud.kept += n
      push()
    },
    setBookRect(provider) {
      rectProvider = provider
    },
    setHiddenHandler(handler) {
      hiddenHandler = handler
    },
    lamp,
    fill,
    ambient,
    touch,
  }

  const acts = buildActs()
  const inited = new Set<Act>()
  if (import.meta.env.DEV) (window as { __scene?: THREE.Scene }).__scene = scene

  // ---- gates ----
  type Lock = { p: number; act: Act; state: 'locked' | 'armed' | 'done'; typed: number; hold: number; missed: boolean }
  const locks: Lock[] = acts
    .filter((act) => act.gate)
    .map((act) => ({ p: act.gateAt ?? act.span[1], act, state: 'locked' as const, typed: 0, hold: 0, missed: false }))
    .sort((a, b) => a.p - b.p)

  const gateKind = (lock: Lock) => (touch && lock.act.gate!.kind !== 'hold' ? 'hold' : lock.act.gate!.kind)

  function gateState(lock: Lock): GateState {
    const kind = gateKind(lock)
    const target = kind === 'hold' ? undefined : lock.act.gate!.target
    return {
      kind,
      prompt: lock.act.gate!.prompt,
      hint: kind === 'hold' ? (touch ? 'touch and hold' : 'hold space, or press and hold') : '',
      target,
      typed: lock.typed,
      progress: kind === 'hold' ? lock.hold : target ? lock.typed / target.length : 0,
      missed: lock.missed,
    }
  }

  const nextLock = () => locks.find((lock) => lock.state !== 'done')

  function completeLock(lock: Lock) {
    lock.state = 'done'
    lock.hold = 1
    holding = false
    lock.act.gate!.onComplete?.(ctx)
    audio.cue('complete')
    hud.gate = null
    push()
  }

  // ---- the one scroll value ----
  let target = 0
  let value = 0

  // Development aid: ?p=0.6 opens the story at that point with earlier gates passed.
  const jump = parseFloat(new URLSearchParams(location.search).get('p') ?? '')
  if (!Number.isNaN(jump)) {
    for (const lock of locks) {
      if (lock.p <= jump + 0.001) {
        lock.state = 'done'
        lock.hold = 1
        lock.act.gate!.onComplete?.(ctx)
      }
    }
    target = clamp01(jump)
    value = Math.max(0, target - 0.03)
  }
  let holding = false
  let pointerX = 0
  let pointerY = 0
  let swayX = 0
  let swayY = 0

  const limit = () => {
    const lock = nextLock()
    return lock ? lock.p : 1
  }

  function nudge(px: number) {
    target = clamp01(target + px / TOTAL_PX)
    audio.start()
  }

  // ---- input ----
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    nudge(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY)
  }

  let touchY: number | null = null
  function onTouchStart(e: TouchEvent) {
    touchY = e.touches[0].clientY
    holding = true
    audio.start()
  }
  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
    const y = e.touches[0].clientY
    if (touchY !== null && Math.abs(touchY - y) > 6) holding = false
    if (touchY !== null) nudge((touchY - y) * 2.4)
    touchY = y
  }
  function onTouchEnd() {
    touchY = null
    holding = false
  }

  function armedLock(): Lock | null {
    const lock = nextLock()
    if (!lock || lock.state === 'done') return null
    return value > lock.p - 0.004 && target >= lock.p - 0.0001 ? lock : null
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    audio.start()
    const lock = armedLock()
    if (lock && lock.state === 'armed') {
      const kind = gateKind(lock)
      if (kind === 'hold') {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          holding = true
        }
        return
      }
      // Enter watches instead of typing; the story should never be locked behind a keyboard.
      if (e.key === 'Enter') {
        e.preventDefault()
        completeLock(lock)
        return
      }
      if (e.key.length === 1) {
        e.preventDefault()
        const targetText = lock.act.gate!.target!
        const want = targetText[lock.typed]
        let finished = false
        if (e.key.toLowerCase() === want.toLowerCase()) {
          lock.typed++
          lock.missed = false
          lock.act.gate!.onKey?.(true, lock.typed - 1, ctx)
          audio.cue('key')
          if (lock.typed >= targetText.length) {
            finished = true
            completeLock(lock)
          }
        } else {
          lock.missed = true
          lock.act.gate!.onKey?.(false, lock.typed, ctx)
          audio.cue('miss')
        }
        hud.gate = finished ? null : gateState(lock)
        push()
      }
      return
    }
    if (e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(e.key === ' ' ? 700 : 450)
    } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
      e.preventDefault()
      nudge(e.key === 'PageUp' ? -700 : -450)
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') holding = false
  }

  function onPointerDown() {
    holding = true
    audio.start()
  }
  function onPointerUp() {
    holding = false
  }
  function onPointerMove(e: PointerEvent) {
    pointerX = (e.clientX / W) * 2 - 1
    pointerY = (e.clientY / H) * 2 - 1
  }

  addEventListener('wheel', onWheel, { passive: false })
  addEventListener('touchstart', onTouchStart, { passive: true })
  addEventListener('touchmove', onTouchMove, { passive: false })
  addEventListener('touchend', onTouchEnd)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)
  addEventListener('pointerdown', onPointerDown)
  addEventListener('pointerup', onPointerUp)
  addEventListener('pointermove', onPointerMove, { passive: true })

  function resize() {
    W = innerWidth
    H = innerHeight
    distance = H / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)))
    camera.aspect = W / H
    camera.position.z = distance
    camera.far = distance * 6
    camera.updateProjectionMatrix()
    renderer.setSize(W, H, false)
    lamp.position.set(-W * 0.35, H * 0.7, distance * 0.9)
  }
  addEventListener('resize', resize)

  // ---- adaptive quality: trade pixels, never narrative ----
  let frameMs = 16
  let tier = 2
  let tierCooldown = 0
  const DPRS = [1, 1.5, Math.min(devicePixelRatio, 2)]

  function govern(dt: number) {
    frameMs += (dt * 1000 - frameMs) * 0.05
    tierCooldown -= dt
    if (tierCooldown > 0) return
    if (frameMs > 24 && tier > 0) {
      tier--
      renderer.setPixelRatio(DPRS[tier])
      tierCooldown = 2.5
    } else if (frameMs < 13 && tier < 2) {
      tier++
      renderer.setPixelRatio(DPRS[tier])
      tierCooldown = 4
    }
  }

  // ---- the loop ----
  let frame = 0
  let disposed = false
  let last = 0
  let lastAct = -1

  function actAt(p: number) {
    for (let i = acts.length - 1; i >= 0; i--) {
      if (p >= acts[i].span[0]) return i
    }
    return 0
  }

  function draw(now: number) {
    if (disposed) return
    frame = requestAnimationFrame(draw)
    const dt = Math.min((now - (last || now)) / 1000, 0.05)
    last = now
    const time = now / 1000
    govern(dt)

    // Scroll eases toward its target; the target never passes the first locked gate.
    const lim = limit()
    if (target > lim) target = lim
    value += (target - value) * Math.min(1, dt * 4.5)

    // Gates arm when the story arrives at them, and holds accumulate.
    const lock = armedLock()
    if (lock) {
      if (lock.state === 'locked') {
        lock.state = 'armed'
        hud.gate = gateState(lock)
        push()
      }
      if (gateKind(lock) === 'hold') {
        const before = lock.hold
        lock.hold = clamp01(lock.hold + (holding ? dt / 1.3 : -dt * 1.6))
        if (lock.hold !== before) {
          lock.act.gate!.onProgress?.(lock.hold, ctx)
          if (holding && Math.random() < dt * 4) audio.cue('hold')
          hud.gate = gateState(lock)
          push()
        }
        if (lock.hold >= 1 && lock.state === 'armed') completeLock(lock)
      }
    } else if (hud.gate && !locks.some((l) => l.state === 'armed')) {
      hud.gate = null
      push()
    }

    swayX += (pointerX - swayX) * Math.min(1, dt * 3)
    swayY += (pointerY - swayY) * Math.min(1, dt * 3)
    root.rotation.y = swayX * 0.03
    root.rotation.x = -swayY * 0.022

    // Acts near the reader run; the rest sleep.
    for (const act of acts) {
      const [a, b] = act.span
      const near = value > a - 0.1 && value < b + 0.1
      if (near && !inited.has(act)) {
        inited.add(act)
        act.init(ctx)
      }
      act.setVisible(near)
      if (near) {
        const local = clamp01((value - a) / (b - a))
        act.scrub(local, ctx, value)
        act.update(dt, time, ctx)
      }
    }

    const current = actAt(value)
    if (current !== lastAct) {
      lastAct = current
      hud.act = current
      hud.actTitle = acts[current].title
      hud.atDesk = current === acts.length - 1
      audio.setAct(current)
      push()
    }
    // The act the reader is inside owns the caption.
    const [ca, cb] = acts[current].span
    const caption = acts[current].caption?.(clamp01((value - ca) / (cb - ca))) ?? null
    if (hud.caption !== caption) {
      hud.caption = caption
      push()
    }

    const rounded = Math.round(value * 500) / 500
    if (rounded !== hud.progress) {
      hud.progress = rounded
      push()
    }
    if (hudDirty) {
      hudDirty = false
      options.onHud({ ...hud })
    }

    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(draw)

  return {
    wake() {
      audio.start()
    },
    bookRect() {
      return rectProvider ? rectProvider() : null
    },
    setHidden(hidden) {
      hiddenHandler?.(hidden)
    },
    toggleAudio() {
      return audio.toggle()
    },
    skipGate() {
      const lock = nextLock()
      if (lock && lock.state !== 'done') completeLock(lock)
    },
    jumpToDesk() {
      for (const lock of locks) {
        if (lock.state !== 'done') {
          lock.state = 'done'
          lock.hold = 1
          lock.act.gate!.onComplete?.(ctx)
        }
      }
      hud.gate = null
      target = 1
      push()
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      removeEventListener('wheel', onWheel)
      removeEventListener('touchstart', onTouchStart)
      removeEventListener('touchmove', onTouchMove)
      removeEventListener('touchend', onTouchEnd)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
      removeEventListener('pointerdown', onPointerDown)
      removeEventListener('pointerup', onPointerUp)
      removeEventListener('pointermove', onPointerMove)
      removeEventListener('resize', resize)
      for (const act of acts) act.dispose()
      audio.dispose()
      renderer.dispose()
    },
  }
}
