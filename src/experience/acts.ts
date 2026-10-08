// The six acts of the landing page, each a small scene that reads the one scroll value.
// I: a flood of disposable words. II: a page that smokes away as it is read, unless held.
// III: typed letters fall as ink and are kept. IV: the book. V: into the page. VI: the desk.
import * as THREE from 'three'
import { buildBook, type Book } from './book'
import { glyphSprite, TextPlane, wordSprite, wrap, measure, type TextStyle } from './text'
import type { Act, Ctx } from './core'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

const INK = '#efe3c8'
const FAINT = '#8d7f68'
const LAMP = '#ffc06e'

const WALDEN_PAGE =
  'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life.'

const TUNNEL_LINES = [
  'The mass of men lead lives of quiet desperation.',
  'Our life is frittered away by detail.',
  'Simplify, simplify.',
  'Read the best books first.',
  'A written word is the choicest of relics.',
  'Books must be read as deliberately as they were written.',
  'The sun is but a morning star.',
  'To affect the quality of the day, that is the highest of arts.',
  'I wanted to live deep and suck out all the marrow of life.',
  'Heaven is under our feet as well as over our heads.',
  'All change is a miracle to contemplate.',
  'We must learn to reawaken and keep ourselves awake.',
]

const FLOOD_WORDS = [
  'breaking', 'trending', 'sponsored', 'unread', 'notifications', 'swipe', 'caption', 'headline',
  'summary', 'thread', 'update', 'like', 'share', 'reply', 'subscribe', 'skip', 'next', 'autoplay',
  'shorts', 'feed', 'refresh', 'scroll', 'views', 'muted', 'inbox', 'alert', 'stream', 'posted',
  'tl;dr', 'recap', 'digest', 'clip',
]

function bigStyle(W: number): TextStyle {
  return { size: Math.min(Math.max(W * 0.044, 30), 62), weight: 500, italic: true }
}

// ---------------------------------------------------------------- act 0: the gate

function actGate(): Act {
  const group = new THREE.Group()
  let letters: TextPlane[] = []
  let caret: THREE.Mesh | null = null
  let caretMat: THREE.MeshBasicMaterial | null = null
  let lit = 0
  let done = false
  let doneAt = 0

  return {
    title: 'A lamp, unlit',
    span: [0, 0.05],
    gateAt: 0,
    gate: {
      kind: 'type',
      prompt: 'Type “read” to begin',
      target: 'read',
      onKey(correct, index, ctx) {
        if (!correct) return
        lit = index + 1
        const letter = letters[index]
        if (letter) letter.reveal = 1
        ctx.audio.cue(index === 3 ? 'ignite' : 'key')
      },
      onComplete(ctx) {
        done = true
        doneAt = performance.now() / 1000
        lit = 4
        letters.forEach((l) => (l.reveal = 1))
        ctx.addKept(1)
      },
    },
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const size = Math.min(Math.max(W * 0.13, 64), 170)
      const style: TextStyle = { size, weight: 500, italic: true }
      const chars = ['r', 'e', 'a', 'd']
      const widths = chars.map((c) => measure(c, style))
      const gap = size * 0.06
      const total = widths.reduce((a, b) => a + b, 0) + gap * 3
      let x = -total / 2
      letters = chars.map((c, i) => {
        const plane = new TextPlane(c, style, { color: INK, warm: LAMP })
        plane.reveal = 0
        plane.mesh.position.set(x + widths[i] / 2, 0, 0)
        x += widths[i] + gap
        group.add(plane.mesh)
        return plane
      })
      caretMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(LAMP), transparent: true })
      caret = new THREE.Mesh(new THREE.PlaneGeometry(3, size * 0.75), caretMat)
      caret.position.set(-total / 2 - size * 0.1, 0, 0)
      group.add(caret)
    },
    scrub(local) {
      // Once the word is lit, scrolling lifts it into smoke.
      const out = ease(local)
      letters.forEach((l, i) => {
        l.dissolve = out
        l.mesh.position.y = out * (90 + i * 25)
      })
      if (caretMat) caretMat.opacity = (1 - out) * (done ? 0 : 1)
      group.visible = local < 1
    },
    update(dt, time, ctx) {
      letters.forEach((l, i) => {
        l.tick(time + i)
        // Unlit letters wait as ghosts; lit ones breathe.
        if (!done) l.reveal = i < lit ? 1 : 0.16 + Math.sin(time * 1.4 + i) * 0.03
      })
      if (caret && caretMat && !done) {
        caretMat.opacity = Math.sin(time * 5) > -0.2 ? 0.9 : 0.1
        const style = letters[0] ? letters[0].width : 60
        const target = lit === 0 ? caret.position.x : letters[lit - 1].mesh.position.x + style * 0.62
        caret.position.x += (target - caret.position.x) * Math.min(1, dt * 10)
      }
      // The lamp comes up a step for every letter kept.
      const t = ctx.lamp.intensity
      const want = done ? 2.3 : 0.55 + lit * 0.42
      ctx.lamp.intensity = t + (want - t) * Math.min(1, dt * 2.5)
      const doneFor = done ? performance.now() / 1000 - doneAt : 0
      ctx.ambient.intensity = lerp(0.35, 0.95, clamp01(lit / 4 + doneFor * 0.5))
    },
    caption(local: number) {
      return done && local < 0.4 ? 'Good. The lamp is lit. Scroll when you are ready.' : null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      letters.forEach((l) => l.dispose())
      caret?.geometry.dispose()
      caretMat?.dispose()
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act I: the flood

function actFlood(): Act {
  const group = new THREE.Group()
  let planes1: TextPlane[] = []
  let line2: TextPlane | null = null
  type Drop = { sprite: THREE.Sprite; speed: number; x: number; y: number; wobble: number }
  const drops: Drop[] = []
  let lastLocal = 0
  let localNow = 0

  return {
    title: 'The flood',
    span: [0.04, 0.2],
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const H = ctx.height()
      const style = bigStyle(W)
      const wrap1 = wrap('You will read a hundred thousand words today.', style, Math.min(W * 0.8, 760))
      // The headline is one plane per wrapped line, grouped.
      const l1 = new THREE.Group()
      planes1 = wrap1.map((text, i) => {
        const p = new TextPlane(text, style, { color: INK, warm: LAMP })
        p.mesh.position.y = -(i - (wrap1.length - 1) / 2) * style.size * 1.28
        l1.add(p.mesh)
        return p
      })
      l1.position.y = H * 0.08
      group.add(l1)
      const style2: TextStyle = { ...style, size: style.size * 0.74 }
      line2 = new TextPlane('How much of yesterday’s did you keep?', style2, { color: INK, warm: LAMP })
      line2.mesh.position.y = -H * 0.06
      group.add(line2.mesh)

      const count = ctx.touch || W < 700 ? 55 : 105
      const small: TextStyle = { size: 15, weight: 400 }
      for (let i = 0; i < count; i++) {
        const word = FLOOD_WORDS[i % FLOOD_WORDS.length]
        const sprite = wordSprite(word, { ...small, italic: i % 3 === 0 }, i % 11 === 0 ? LAMP : FAINT)
        sprite.position.set((Math.random() - 0.5) * W * 1.2, (Math.random() - 0.5) * H * 1.1, -1400 * Math.random())
        group.add(sprite)
        drops.push({
          sprite,
          speed: lerp(160, 420, Math.random()),
          x: sprite.position.x,
          y: sprite.position.y,
          wobble: Math.random() * Math.PI * 2,
        })
      }
    },
    scrub(local, ctx) {
      localNow = local
      planes1.forEach((p, i) => {
        p.reveal = ease(seg(local, 0.05 + i * 0.04, 0.22 + i * 0.04))
        p.dissolve = ease(seg(local, 0.5, 0.68)) // the headline itself is washed away
      })
      if (line2) line2.reveal = ease(seg(local, 0.62, 0.8))
      if (line2) line2.dissolve = ease(seg(local, 0.93, 1))
      group.position.z = lerp(-40, 60, local)
      ctx.lamp.intensity = 2.3
      ctx.ambient.intensity = 0.95
    },
    update(dt, time, ctx) {
      planes1.forEach((p, i) => p.tick(time + i * 3))
      line2?.tick(time + 9)
      const W = ctx.width()
      const H = ctx.height()
      const rush = 1 + Math.abs(localNow - lastLocal) * 260
      lastLocal = localNow
      const envelope = Math.sin(Math.PI * clamp01(localNow)) // present through the act, absent at its edges
      for (const d of drops) {
        d.sprite.position.z += d.speed * rush * dt
        d.sprite.position.x = d.x + Math.sin(time * 0.5 + d.wobble) * 30
        d.sprite.position.y = d.y + Math.cos(time * 0.4 + d.wobble) * 22
        if (d.sprite.position.z > 240) {
          d.sprite.position.z = -1400
          d.x = (Math.random() - 0.5) * W * 1.2
          d.y = (Math.random() - 0.5) * H * 1.1
        }
        const near = clamp01((d.sprite.position.z + 1400) / 1500)
        ;(d.sprite.material as THREE.SpriteMaterial).opacity = envelope * near * (1 - seg(d.sprite.position.z, 120, 240)) * 0.8
      }
    },
    caption(local: number) {
      if (local > 0.1 && local < 0.6)
        return 'Feeds. Captions. Headlines. Summaries of summaries. Written to be swallowed, not kept.'
      return null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      planes1.forEach((p) => p.dispose())
      line2?.dispose()
      drops.forEach((d) => (d.sprite.material as THREE.SpriteMaterial).dispose())
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act II: the vanishing

function actVanish(): Act {
  const group = new THREE.Group()
  let lines: TextPlane[] = []
  let heading: TextPlane | null = null
  let closing: TextPlane | null = null
  let eye: THREE.Mesh | null = null
  let eyeMat: THREE.MeshBasicMaterial | null = null
  let held = false
  let holdGlow = 0

  return {
    title: 'The vanishing',
    span: [0.19, 0.42],
    gateAt: 0.4,
    gate: {
      kind: 'hold',
      prompt: 'Hold the last line before it goes',
      onProgress(p) {
        holdGlow = p
      },
      onComplete(ctx) {
        held = true
        holdGlow = 1
        const last = lines[lines.length - 1]
        if (last) {
          last.dissolve = 0
          last.setColor(LAMP)
        }
        ctx.addKept(WALDEN_PAGE.split(' ').slice(-9).length)
      },
    },
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const H = ctx.height()
      const style: TextStyle = { size: Math.min(Math.max(W * 0.019, 17), 24), weight: 400 }
      const wrapped = wrap(WALDEN_PAGE, style, Math.min(W * 0.72, 600))
      const lineHeight = style.size * 1.62
      lines = wrapped.map((text, i) => {
        const p = new TextPlane(text, style, { color: INK, warm: LAMP, noise: 8 })
        p.mesh.position.set(0, (wrapped.length / 2 - i) * lineHeight - H * 0.02, 0)
        group.add(p.mesh)
        return p
      })
      const hs = bigStyle(W)
      heading = new TextPlane('This is what reading has become.', { ...hs, size: hs.size * 0.82 }, { color: INK, warm: LAMP })
      heading.mesh.position.y = (wrapped.length / 2) * lineHeight + H * 0.09
      group.add(heading.mesh)
      closing = new TextPlane('By tomorrow, almost none of it is still with you.', { ...hs, size: hs.size * 0.72 }, {
        color: INK,
        warm: LAMP,
      })
      closing.mesh.position.y = -(wrapped.length / 2) * lineHeight - H * 0.1
      group.add(closing.mesh)

      eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(LAMP), transparent: true, opacity: 0 })
      eye = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.76, 640), 2), eyeMat)
      group.add(eye)
    },
    scrub(local, ctx) {
      const n = lines.length
      lines.forEach((p, i) => {
        p.reveal = ease(seg(local, 0.02 + (i / n) * 0.16, 0.1 + (i / n) * 0.16))
      })
      heading && (heading.reveal = ease(seg(local, 0, 0.1)))
      heading && (heading.dissolve = ease(seg(local, 0.3, 0.45)))
      // The eye moves down the page; what it has read begins to smoke.
      const sweep = seg(local, 0.22, 0.78)
      const top = lines[0]?.mesh.position.y ?? 0
      const bottom = lines[n - 1]?.mesh.position.y ?? 0
      if (eye && eyeMat) {
        eye.position.y = lerp(top + 20, bottom - 8, sweep)
        eyeMat.opacity = sweep > 0 && sweep < 1 ? 0.35 : 0
      }
      // The eye's wake: every line it has passed smokes away, except the last, which is the
      // gate's hostage and lives in update().
      lines.forEach((p, i) => {
        if (i === n - 1) return
        const read = clamp01(sweep * (n + 2.5) - i)
        p.dissolve = clamp01(read * 0.85)
      })
      closing && (closing.reveal = ease(seg(local, 0.8, 0.92)))
      closing && (closing.dissolve = ease(seg(local, 0.96, 1)))
      // Everything, the kept line included, leaves with the act.
      const leave = ease(seg(local, 0.94, 1))
      group.position.y = lerp(0, ctx.height() * 0.08, leave)
      const last = lines[lines.length - 1]
      if (last) last.opacity = 1 - leave
      ctx.lamp.intensity = lerp(2.3, 1.7, seg(local, 0.3, 0.9))
      ctx.ambient.intensity = lerp(0.95, 0.8, seg(local, 0.3, 0.9))
    },
    update(dt, time) {
      lines.forEach((p, i) => p.tick(time + i * 1.7))
      heading?.tick(time)
      closing?.tick(time + 4)
      const last = lines[lines.length - 1]
      if (last && !held && last.reveal > 0.5) {
        // Unheld, the hostage line creeps toward smoke; holding pulls it back to ink.
        if (holdGlow > 0.02) last.dissolve = Math.max(0, last.dissolve - (holdGlow * 1.6 + 0.2) * dt)
        else last.dissolve = Math.min(last.dissolve + dt * 0.055, 0.85)
      }
    },
    caption(local: number) {
      if (held && local < 0.98) return 'What you hold, stays.'
      if (local > 0.24 && local < 0.7) return 'A beautiful page, passing through you.'
      return null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      lines.forEach((p) => p.dispose())
      heading?.dispose()
      closing?.dispose()
      eye?.geometry.dispose()
      eyeMat?.dispose()
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act III: the hands

function actHands(): Act {
  const group = new THREE.Group()
  let heading: TextPlane | null = null
  let ghost: TextPlane | null = null
  let slots: { x: number; sprite?: THREE.Sprite }[] = []
  type Fall = { sprite: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; t: number; landed: boolean }
  let falling: Fall[] = []
  let lineStyle: TextStyle = { size: 34 }
  let lineY = 0
  let done = false

  return {
    title: 'The hands',
    span: [0.42, 0.58],
    gateAt: 0.5,
    gate: {
      kind: 'line',
      prompt: 'Copy the line',
      target: 'Simplify, simplify',
      onKey(correct, index, ctx) {
        if (!correct || !slots[index]) return
        const char = 'Simplify, simplify'[index]
        if (char === ' ') return
        const sprite = glyphSprite(char, lineStyle, LAMP)
        const to = new THREE.Vector3(slots[index].x, lineY, 4)
        const from = new THREE.Vector3(to.x + (Math.random() - 0.5) * 240, lineY - ctx.height() * 0.3, 70)
        sprite.position.copy(from)
        ;(sprite.material as THREE.SpriteMaterial).rotation = (Math.random() - 0.5) * 1.2
        group.add(sprite)
        falling.push({ sprite, from, to, t: 0, landed: false })
      },
      onComplete(ctx) {
        done = true
        ctx.addKept(2)
      },
    },
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const H = ctx.height()
      const hs = bigStyle(W)
      heading = new TextPlane('What the hand writes, the mind keeps.', { ...hs, size: hs.size * 0.88 }, {
        color: INK,
        warm: LAMP,
      })
      heading.mesh.position.y = H * 0.16
      group.add(heading.mesh)

      lineStyle = { size: Math.min(Math.max(W * 0.034, 26), 44), weight: 500, italic: true }
      const text = 'Simplify, simplify'
      ghost = new TextPlane(text, lineStyle, { color: FAINT, warm: LAMP })
      ghost.reveal = 0
      lineY = -H * 0.05
      ghost.mesh.position.set(0, lineY, 0)
      group.add(ghost.mesh)
      // Slot x positions for each character, measured incrementally.
      let acc = 0
      slots = [...text].map((_, i) => {
        const before = measure(text.slice(0, i), lineStyle)
        const at = measure(text.slice(0, i + 1), lineStyle)
        acc = at
        return { x: -measure(text, lineStyle) / 2 + (before + at) / 2 }
      })
      void acc
    },
    scrub(local, ctx) {
      heading && (heading.reveal = ease(seg(local, 0.04, 0.22)))
      heading && (heading.dissolve = ease(seg(local, 0.88, 1)))
      if (ghost) ghost.reveal = lerp(0, 0.3, ease(seg(local, 0.18, 0.4)))
      const out = ease(seg(local, 0.88, 1))
      group.position.y = out * ctx.height() * 0.12
      for (const f of falling) (f.sprite.material as THREE.SpriteMaterial).opacity = 1 - out
      if (ghost) ghost.opacity = 1 - out
      ctx.lamp.intensity = lerp(1.7, 2.4, seg(local, 0.1, 0.6))
      ctx.ambient.intensity = lerp(0.8, 0.95, seg(local, 0.1, 0.6))
    },
    update(dt, time, ctx) {
      heading?.tick(time)
      ghost?.tick(time + 2)
      for (const f of falling) {
        if (f.landed) continue
        f.t = Math.min(f.t + dt / 0.55, 1)
        const e = easeOut(f.t)
        // A low arc up and over, like a letter tossed onto the page.
        f.sprite.position.lerpVectors(f.from, f.to, e)
        f.sprite.position.y += Math.sin(e * Math.PI) * 60
        const material = f.sprite.material as THREE.SpriteMaterial
        material.rotation *= 1 - e
        if (f.t >= 1) {
          f.landed = true
          material.rotation = 0
          ctx.audio.cue('land')
        }
      }
    },
    caption(local: number) {
      if (done && local < 0.85) return 'A copied page is read twice.'
      if (local > 0.2 && local < 0.85)
        return 'For a thousand years, copying a text was how a text was learned by heart.'
      return null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      heading?.dispose()
      ghost?.dispose()
      falling.forEach((f) => (f.sprite.material as THREE.SpriteMaterial).dispose())
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act IV: the book

function actBook(): Act {
  const group = new THREE.Group()
  let book: Book | null = null
  let headingLines: TextPlane[] = []
  let turnsCued = 0
  let localNow = 0

  return {
    title: 'The book',
    span: [0.56, 0.78],
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const H = ctx.height()
      book = buildBook({
        title: 'Walden',
        height: Math.min(H * 0.5, W * 0.52),
        cloth: 'oklch(0.34 0.055 155)',
        clothDeep: 'oklch(0.27 0.055 155)',
      })
      book.applyCover(localStorage.getItem('retype.cover.sample') || undefined)
      group.add(book.group)
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(W * 4, H * 4),
        new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }),
      )
      ground.receiveShadow = true
      ground.position.z = -book.d * 1.6
      group.add(ground)
      const hs = { ...bigStyle(W), size: bigStyle(W).size * 0.92 }
      const narrow = W < 700
      const wrapped = wrap('Bring a book you love.', hs, narrow ? W * 0.84 : Math.min(W * 0.26, 360))
      headingLines = wrapped.map((text, i) => {
        const p = new TextPlane(text, hs, { color: INK, warm: LAMP })
        p.mesh.position.y = -(i - (wrapped.length - 1) / 2) * hs.size * 1.22
        const holder = new THREE.Group()
        holder.add(p.mesh)
        group.add(holder)
        return p
      })
    },
    scrub(local, ctx) {
      localNow = local
      if (!book) return
      const W = ctx.width()
      const H = ctx.height()
      const narrow = W < 700
      const enter = ease(seg(local, 0, 0.2))
      const open = ease(seg(local, 0.22, 0.42))
      const turns = seg(local, 0.36, 0.84)
      const dive = ease(seg(local, 0.86, 1))

      book.setOpen(open)
      book.setTurns(turns)
      const cued = Math.floor(turns * 5)
      if (cued > turnsCued) {
        turnsCued = cued
        ctx.audio.cue('page')
      }

      const scale = lerp(0.82, 1, enter) * lerp(1, 0.94, open) * lerp(1, 3.6, dive)
      const spreadCentre = narrow ? 0 : W * 0.13
      const x = lerp(narrow ? 0 : W * 0.16, (book.w / 2) * scale + spreadCentre, open) * (1 - dive)
      const y = lerp(-H * 0.9, narrow ? -H * 0.2 : -H * 0.03, enter) + dive * H * 0.05
      book.group.position.set(x, y, (book.d * scale) / 2 + 2 + book.d * 1.6)
      book.group.scale.setScalar(scale)
      book.group.rotation.y = lerp(-0.42, -0.03, open)
      book.group.rotation.x = lerp(-0.05, -0.5, open) * (1 - dive * 0.6)

      headingLines.forEach((p, i) => {
        p.reveal = ease(seg(local, 0.12 + i * 0.05, 0.3 + i * 0.05))
        p.dissolve = ease(seg(local, 0.78, 0.9))
        p.mesh.parent!.position.set(narrow ? 0 : -W * 0.3, narrow ? H * 0.3 : H * 0.07, 40)
      })

      // Fully dived, the act yields the screen to the inside of the page (the tunnel's veil).
      group.visible = local < 0.999
      ctx.lamp.intensity = 2.4
      ctx.ambient.intensity = lerp(0.95, 1.15, dive)
    },
    update(_dt, time) {
      headingLines.forEach((p, i) => p.tick(time + i * 2))
      if (book) book.group.position.y += Math.sin(time * 0.8) * 4 * (1 - ease(seg(localNow, 0.86, 1)))
    },
    caption(local: number) {
      if (local > 0.3 && local < 0.8)
        return 'A PDF, an EPUB, plain text. retype lays it on the desk, keeps your place to the word, and never shows a words-per-minute while you read.'
      return null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      book?.dispose()
      headingLines.forEach((p) => p.dispose())
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act V: the tunnel

function actTunnel(): Act {
  const group = new THREE.Group()
  const corridor = new THREE.Group()
  let planes: TextPlane[] = []
  let heading: TextPlane | null = null
  let veil: THREE.Mesh | null = null
  let veilMat: THREE.MeshBasicMaterial | null = null
  let entered = false
  const SPACING = 190

  return {
    title: 'Into the page',
    span: [0.77, 0.92],
    init(ctx) {
      ctx.scene.add(group)
      group.add(corridor)
      const W = ctx.width()
      const H = ctx.height()
      const style: TextStyle = { size: Math.min(Math.max(W * 0.02, 17), 26), weight: 400 }
      const count = ctx.touch || W < 700 ? 26 : 40
      for (let i = 0; i < count; i++) {
        const text = TUNNEL_LINES[i % TUNNEL_LINES.length]
        const p = new TextPlane(text, style, { color: INK, warm: LAMP })
        const side = i % 2 === 0 ? -1 : 1
        const lane = Math.random() < 0.5 ? -1 : 1
        p.mesh.position.set(
          side * lerp(W * 0.12, W * 0.26, Math.random()),
          // The middle stays clear for the one line that is not passing through.
          lane * lerp(H * 0.1, H * 0.26, Math.random()),
          -i * SPACING,
        )
        p.mesh.rotation.y = side * 0.35
        p.reveal = 1
        corridor.add(p.mesh)
        planes.push(p)
      }
      const hs = bigStyle(W)
      heading = new TextPlane('Twenty minutes a night. A book a season.', { ...hs, size: hs.size * 0.8 }, {
        color: INK,
        warm: LAMP,
      })
      heading.mesh.position.set(0, 0, 40)
      group.add(heading.mesh)
      // The white of the page, entered: it dims into the dark between the lines.
      veilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f1ebdd'), transparent: true, opacity: 1 })
      veil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.4, H * 2.4), veilMat)
      veil.position.z = 240
      veil.renderOrder = 30
      group.add(veil)
    },
    scrub(local, ctx, global_) {
      const depth = planes.length * SPACING
      corridor.position.z = local * (depth + 500)
      if (!entered && local > 0.04) {
        entered = true
        ctx.audio.cue('whoosh')
      }
      if (local < 0.03) entered = false
      const envelope = Math.min(seg(local, 0, 0.06), 1 - seg(local, 0.93, 1))
      for (const p of planes) {
        const z = p.mesh.position.z + corridor.position.z
        // Lines glow as they pass the reader and fade with distance ahead.
        const near = clamp01(1 - Math.abs(z + 320) / 900)
        p.opacity = near * envelope
        p.setColor(z > -240 ? LAMP : INK)
      }
      if (heading) {
        heading.reveal = ease(seg(local, 0.42, 0.56))
        heading.dissolve = ease(seg(local, 0.78, 0.92))
        heading.opacity = envelope
      }
      if (veil && veilMat) {
        // The white of the page blooms only once the dive has actually filled the frame,
        // then dims into the dark between the lines.
        const bloom = seg(global_, 0.768, 0.779)
        veilMat.opacity = bloom * (1 - ease(seg(local, 0.02, 0.17)))
        veil.visible = veilMat.opacity > 0.01
      }
      ctx.lamp.intensity = 1.9
      ctx.ambient.intensity = 1.1
    },
    update(_dt, time) {
      heading?.tick(time)
      for (let i = 0; i < planes.length; i += 3) planes[i].tick(time + i)
    },
    caption(local: number) {
      return local > 0.3 && local < 0.9 ? 'Every word through your hands.' : null
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      planes.forEach((p) => p.dispose())
      heading?.dispose()
      veil?.geometry.dispose()
      veilMat?.dispose()
    },
  } as Act & { caption(local: number): string | null }
}

// ---------------------------------------------------------------- act VI: the desk

function actDesk(): Act {
  const group = new THREE.Group()
  let book: Book | null = null
  let heading: TextPlane | null = null
  let hidden = false
  let pose = { x: 0, y: 0, scale: 1 }

  return {
    title: 'The desk',
    span: [0.9, 1],
    init(ctx) {
      ctx.scene.add(group)
      const W = ctx.width()
      const H = ctx.height()
      book = buildBook({
        title: 'Walden',
        height: Math.min(H * 0.42, W * 0.5),
        cloth: 'oklch(0.34 0.055 155)',
        clothDeep: 'oklch(0.27 0.055 155)',
      })
      book.applyCover(localStorage.getItem('retype.cover.sample') || undefined)
      group.add(book.group)
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(W * 4, H * 4),
        new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }),
      )
      ground.receiveShadow = true
      ground.position.z = -book.d * 1.6
      group.add(ground)
      const hs = bigStyle(W)
      heading = new TextPlane('The book is on the desk.', hs, { color: INK, warm: LAMP })
      group.add(heading.mesh)

      ctx.setBookRect(() => {
        const width = book!.w * pose.scale
        const height = book!.h * pose.scale
        return new DOMRect(ctx.width() / 2 + pose.x - width / 2, ctx.height() / 2 - pose.y - height / 2, width, height)
      })
      ctx.setHiddenHandler((h) => {
        hidden = h
        if (book) book.group.visible = !h
      })
    },
    scrub(local, ctx) {
      if (!book || !heading) return
      const W = ctx.width()
      const H = ctx.height()
      const narrow = W < 700
      const enter = ease(seg(local, 0.05, 0.45))
      // The book keeps the left of the desk; the way in sits beside it.
      pose = { x: narrow ? 0 : -W * 0.17, y: lerp(-H * 0.65, narrow ? -H * 0.04 : -H * 0.12, enter), scale: 1 }
      book.group.position.set(pose.x, pose.y, (book.d * pose.scale) / 2 + 2 + book.d * 1.6)
      book.group.scale.setScalar(pose.scale)
      book.group.rotation.y = -0.32
      book.group.rotation.x = -0.05
      book.group.visible = !hidden
      book.setOpen(0)
      book.setTurns(0)
      heading.reveal = ease(seg(local, 0.25, 0.5))
      heading.mesh.position.set(0, narrow ? H * 0.3 : H * 0.24, 20)
      ctx.lamp.intensity = 2.3
      ctx.ambient.intensity = 0.95
    },
    update(_dt, time) {
      heading?.tick(time)
    },
    caption() {
      return null // the HUD's desk panel carries the words here
    },
    setVisible(v) {
      group.visible = v
    },
    dispose() {
      book?.dispose()
      heading?.dispose()
    },
  } as Act & { caption(local: number): string | null }
}

export function buildActs(): Act[] {
  return [actGate(), actFlood(), actVanish(), actHands(), actBook(), actTunnel(), actDesk()]
}
