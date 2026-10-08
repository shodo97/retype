// The opening of a book, drawn with three.js: it lifts off the shelf, the cover swings back,
// the pages turn with a curl, and the view goes into the page. Loaded on demand.
import * as THREE from 'three'

export type SceneOptions = {
  canvas: HTMLCanvasElement
  from: DOMRect // where the book sits on the page, in CSS pixels
  title: string
  depth: number // spine width in CSS pixels
  cover?: string // image for the front board
  cloth: string // CSS colours of the binding
  clothDeep: string
  isReady: () => boolean // the page behind is ready to be shown
  onFirstFrame: () => void
  onEnter: () => void // the view starts going into the page
  onDone: () => void
}

const PAGES = 6
const SEGMENTS = 28
const BOARD = 3 // thickness of a cover board

// Seconds.
const LIFT = 0.85
const COVER_AT = 0.5
const COVER = 1.1
const PAGES_AT = 1.1
const STAGGER = 0.15
const TURN = 0.95
const CYCLE = (PAGES - 1) * STAGGER + TURN
const ENTER = 0.7

const SHELF_TURN = -0.47 // how a book stands on the shelf: rotateY(-27deg)
const DESK_TILT = -0.4 // laid back, as on a desk
const PAPER = '#f1ebdd'
const INK = 'rgba(58, 48, 38, 0.3)'

const clamp = (n: number) => Math.min(Math.max(n, 0), 1)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)
const easeIn = (t: number) => t * t * t

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return [canvas, canvas.getContext('2d')!] as const
}

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  return map
}

// three.js does not read oklch(), so let a canvas resolve the colour.
function cssColor(css: string) {
  const [, ctx] = canvas2d(1, 1)
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 1500)
    image.src = src
  })
}

// The front board: the cover image if there is one, otherwise stamped cloth like the shelf.
function drawCover(o: SceneOptions, image: HTMLImageElement | null) {
  const width = 640
  const height = Math.round((width * o.from.height) / o.from.width)
  const [canvas, ctx] = canvas2d(width, height)
  if (image) {
    const scale = Math.max(width / image.width, height / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
  } else {
    ctx.fillStyle = o.cloth
    ctx.fillRect(0, 0, width, height)
    const light = ctx.createLinearGradient(0, 0, width * 0.6, height * 0.4)
    light.addColorStop(0, 'rgba(255, 255, 255, 0.1)')
    light.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = 'rgba(236, 228, 211, 0.45)'
    ctx.lineWidth = 2
    ctx.strokeRect(width * 0.12, height * 0.07, width * 0.81, height * 0.86)

    const size = width * 0.088
    ctx.font = `500 ${size}px "Literata Variable", Georgia, serif`
    ctx.fillStyle = '#ece4d3'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const lines: string[] = []
    for (const word of o.title.split(/\s+/)) {
      const last = lines[lines.length - 1]
      if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= width * 0.69) {
        lines[lines.length - 1] = `${last} ${word}`
      } else lines.push(word)
    }
    lines.slice(0, 6).forEach((line, i) => ctx.fillText(line, width * 0.515, height * 0.22 + i * size * 1.25))
  }
  // The groove of the hinge.
  const hinge = ctx.createLinearGradient(0, 0, width * 0.1, 0)
  hinge.addColorStop(0, 'rgba(0, 0, 0, 0.3)')
  hinge.addColorStop(0.3, 'rgba(0, 0, 0, 0)')
  hinge.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
  hinge.addColorStop(0.7, 'rgba(0, 0, 0, 0.2)')
  hinge.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = hinge
  ctx.fillRect(0, 0, width * 0.1, height)
  return texture(canvas)
}

// A page of greeked text: bars where the words would be, set in paragraphs.
function drawPage(ratio: number, seed: number, gutterLeft: boolean) {
  const width = 512
  const height = Math.round(width * ratio)
  const [canvas, ctx] = canvas2d(width, height)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, width, height)

  let state = seed
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const left = width * 0.14
  const right = width * 0.87
  const line = height / 34
  ctx.fillStyle = INK
  let toParagraphEnd = 3 + Math.floor(random() * 6)
  let indent = true
  for (let y = height * 0.11; y < height * 0.88; y += line) {
    const last = toParagraphEnd === 0
    const end = last ? left + (right - left) * (0.3 + random() * 0.5) : right
    let x = left + (indent ? width * 0.05 : 0)
    while (x < end - 6) {
      const word = Math.min(8 + random() * 34, end - x)
      ctx.fillRect(x, y, word, line * 0.34)
      x += word + 6
    }
    indent = last
    toParagraphEnd = last ? 3 + Math.floor(random() * 6) : toParagraphEnd - 1
  }

  // The page darkens as it runs into the gutter.
  const gutter = ctx.createLinearGradient(gutterLeft ? 0 : width, 0, gutterLeft ? width * 0.14 : width * 0.86, 0)
  gutter.addColorStop(0, 'rgba(40, 30, 20, 0.22)')
  gutter.addColorStop(1, 'rgba(40, 30, 20, 0)')
  ctx.fillStyle = gutter
  ctx.fillRect(0, 0, width, height)
  return texture(canvas)
}

// Bends a sheet hinged at the spine. `turn` runs from 0, flat on the right, to 1, flat on the
// left. The part by the spine leads and the free edge trails behind it, which is what gives a
// turning page its curve.
function bend(geometry: THREE.PlaneGeometry, turn: number, width: number, curl: number) {
  const position = geometry.attributes.position
  const base = turn * (Math.PI - 0.045)
  const lag = Math.sin(turn * Math.PI) * curl
  const step = width / SEGMENTS
  let x = 0
  let z = 0
  for (let i = 0; i <= SEGMENTS; i++) {
    if (i > 0) {
      const u = (i - 0.5) / SEGMENTS
      const angle = Math.min(Math.max(base - lag * Math.pow(u, 0.85), 0), Math.PI)
      x += Math.cos(angle) * step
      z += Math.sin(angle) * step
    }
    position.setX(i, x)
    position.setZ(i, z)
    position.setX(i + SEGMENTS + 1, x)
    position.setZ(i + SEGMENTS + 1, z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
}

export function playOpening(o: SceneOptions) {
  const W = innerWidth
  const H = innerHeight
  const w = o.from.width
  const h = o.from.height
  const d = o.depth

  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(W, H, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  // One unit is one CSS pixel on the plane the book starts on, with the origin mid-window.
  const fov = 32
  const distance = H / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)))
  const camera = new THREE.PerspectiveCamera(fov, W / H, distance / 20, distance * 3)
  camera.position.z = distance

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1.9))
  const sun = new THREE.DirectionalLight(0xfff4e2, 1.7)
  sun.position.set(-W * 0.35, H * 0.7, distance * 0.9)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const reach = Math.max(W, H)
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: distance * 3 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 1.5
  sun.shadow.radius = 6
  scene.add(sun)

  const disposables: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item)
    return item
  }
  const material = (parameters: THREE.MeshStandardMaterialParameters) =>
    keep(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...parameters }))

  const cloth = material({ color: cssColor(o.cloth) })
  const clothDeep = material({ color: cssColor(o.clothDeep) })
  const paper = material({ color: new THREE.Color(PAPER) })
  const edge = material({ color: new THREE.Color('#ded6c4') })

  // The book turns about its middle; its parts are laid out from the spine.
  const book = new THREE.Group()
  const parts = new THREE.Group()
  parts.position.x = -w / 2
  book.add(parts)
  scene.add(book)

  const box = (width: number, height: number, depth: number) => keep(new THREE.BoxGeometry(width, height, depth))
  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = parts) => {
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  const back = add(new THREE.Mesh(box(w, h, BOARD), clothDeep))
  back.position.set(w / 2, 0, -d / 2 + BOARD / 2)
  const spine = add(new THREE.Mesh(box(BOARD, h, d), clothDeep))
  spine.position.set(-BOARD / 2, 0, 0)

  const pageWidth = w - 6
  const pageHeight = h - 8
  const ratio = pageHeight / pageWidth
  const rightPage = keep(drawPage(ratio, 7, true))
  const block = add(
    new THREE.Mesh(box(pageWidth, pageHeight, d - BOARD * 2), [
      edge,
      edge,
      edge,
      edge,
      material({ map: rightPage }),
      paper,
    ]),
  )
  block.position.set(pageWidth / 2, 0, 0)

  // The front board, hinged at the spine.
  const hinge = new THREE.Group()
  hinge.position.set(0, 0, d / 2 - BOARD / 2)
  parts.add(hinge)
  const coverMaterial = material({ color: cssColor(o.cloth) })
  const endpaper = material({ color: new THREE.Color('#e6dfce') })
  const board = add(new THREE.Mesh(box(w, h, BOARD), [cloth, cloth, cloth, cloth, coverMaterial, endpaper]), hinge)
  board.position.x = w / 2

  // Loose leaves that turn. Each has its own text on the front and back.
  const leaves = Array.from({ length: PAGES }, (_, i) => {
    const geometry = keep(new THREE.PlaneGeometry(pageWidth, pageHeight, SEGMENTS, 1))
    const front = keep(drawPage(ratio, 31 + i * 17, true))
    const leaf = new THREE.Group()
    leaf.position.set(0, 0, d / 2 - BOARD + 0.6 + i * 0.12)
    add(new THREE.Mesh(geometry, material({ map: front, side: THREE.FrontSide })), leaf)
    add(new THREE.Mesh(geometry, material({ map: front, side: THREE.BackSide })), leaf)
    parts.add(leaf)
    bend(geometry, 0, pageWidth, 0)
    return { geometry, curl: 1.25 + ((i * 7) % 5) * 0.12 }
  })

  // Catches the book's shadow on the page behind it.
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(W * 4, H * 4)),
    keep(new THREE.ShadowMaterial({ opacity: 0.16 })),
  )
  ground.receiveShadow = true
  scene.add(ground)

  const scale = Math.min((H * 0.66) / h, (W * 0.42) / w)
  const startX = o.from.left + w / 2 - W / 2
  const startY = H / 2 - (o.from.top + h / 2)

  let frame = 0
  let started = 0
  let enteredAt = 0
  let lastCycle = 0
  let disposed = false
  let drawn = false

  function draw(now: number) {
    if (disposed) return
    frame = requestAnimationFrame(draw)
    started ||= now
    const t = (now - started) / 1000

    const lift = easeInOut(clamp(t / LIFT))
    const opened = easeInOut(clamp((t - COVER_AT) / COVER))

    // Wait for the text, then for the pages in the air to land.
    const turning = t - PAGES_AT
    const cycle = Math.floor(turning / CYCLE)
    if (!enteredAt && cycle > lastCycle && cycle >= 1 && o.isReady()) {
      enteredAt = t
      o.onEnter()
    }
    lastCycle = cycle
    const enter = enteredAt ? clamp((t - enteredAt) / ENTER) : 0
    const into = easeIn(enter)

    // Open, the book slides right so the spine sits mid-window; entering, the right-hand page
    // comes to the middle and fills the view.
    const size = lerp(1, scale, lift) * lerp(1, 3.4, into)
    book.scale.setScalar(size)
    book.position.set(
      lerp(startX, 0, lift) + opened * (1 - easeInOut(enter)) * ((w * scale) / 2),
      lerp(startY, 0, lift),
      (d * size) / 2 + 2,
    )
    book.rotation.y = lerp(SHELF_TURN, 0, lift)
    book.rotation.x = DESK_TILT * opened * (1 - easeInOut(enter))
    hinge.rotation.y = -opened * (Math.PI - 0.03)

    leaves.forEach((leaf, i) => {
      const local = enteredAt ? CYCLE : turning % CYCLE
      const turn = turning < 0 ? 0 : easeInOut(clamp((local - i * STAGGER) / TURN))
      bend(leaf.geometry, turn, pageWidth, leaf.curl)
    })

    o.canvas.style.opacity = String(1 - easeOut(clamp((enter - 0.45) / 0.55)))
    renderer.render(scene, camera)

    if (!drawn) {
      drawn = true
      o.onFirstFrame()
    }
    if (enter >= 1) {
      cancelAnimationFrame(frame)
      o.onDone()
    }
  }

  // Start once the cover has been drawn, so the board never changes face in mid-air.
  void (o.cover ? loadImage(o.cover) : Promise.resolve(null)).then((image) => {
    if (disposed) return
    let map: THREE.CanvasTexture
    try {
      map = drawCover(o, image)
      // Reading back fails if the image came without permission to be used this way.
      if (image) map.image.getContext('2d')!.getImageData(0, 0, 1, 1)
    } catch {
      map = drawCover(o, null)
    }
    coverMaterial.color.set(0xffffff)
    coverMaterial.map = keep(map)
    coverMaterial.needsUpdate = true
    frame = requestAnimationFrame(draw)
  })

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      for (const item of disposables) item.dispose()
      renderer.dispose()
    },
  }
}
