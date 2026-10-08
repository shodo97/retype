// The hardback, built once and posed by the acts: boards, spine, a block of pages, and loose
// leaves that bend as they turn. One world unit is one CSS pixel.
import * as THREE from 'three'

const PAGES = 5
const SEGMENTS = 24
const BOARD = 3
export const RATIO = 1.45 // height of a board to its width

const PAPER = '#f1ebdd'
const GREEK = 'rgba(58, 48, 38, 0.3)'

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
export function cssColor(css: string) {
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
    setTimeout(() => resolve(null), 2000)
    image.src = src
  })
}

// The front board: the cover image if there is one, otherwise stamped cloth.
function drawCover(title: string, cloth: string, image: HTMLImageElement | null) {
  const width = 640
  const height = Math.round(width * RATIO)
  const [canvas, ctx] = canvas2d(width, height)
  if (image) {
    const scale = Math.max(width / image.width, height / image.height)
    const w = image.width * scale
    const h = image.height * scale
    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
  } else {
    ctx.fillStyle = cloth
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
    for (const word of title.split(/\s+/)) {
      const last = lines[lines.length - 1]
      if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= width * 0.69) {
        lines[lines.length - 1] = `${last} ${word}`
      } else lines.push(word)
    }
    lines.slice(0, 6).forEach((line, i) => ctx.fillText(line, width * 0.515, height * 0.22 + i * size * 1.25))
  }
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
function drawPage(seed: number, gutterLeft: boolean) {
  const width = 512
  const height = Math.round(width * RATIO)
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
  ctx.fillStyle = GREEK
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

  const gutter = ctx.createLinearGradient(gutterLeft ? 0 : width, 0, gutterLeft ? width * 0.14 : width * 0.86, 0)
  gutter.addColorStop(0, 'rgba(40, 30, 20, 0.22)')
  gutter.addColorStop(1, 'rgba(40, 30, 20, 0)')
  ctx.fillStyle = gutter
  ctx.fillRect(0, 0, width, height)
  return texture(canvas)
}

// Bends a sheet hinged at the spine; the free edge trails the spine, which is the curl.
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

export type Book = {
  group: THREE.Group
  w: number
  h: number
  d: number
  setOpen(openness: number): void // 0 closed .. 1 cover flat open
  setTurns(progress: number): void // 0..1 staggers the loose leaves over
  applyCover(src?: string): void
  dispose(): void
}

export function buildBook(options: { title: string; height: number; cloth: string; clothDeep: string }): Book {
  const h = options.height
  const w = h / RATIO
  const d = Math.max(30, Math.round(w * 0.13))

  const disposables: { dispose: () => void }[] = []
  const keep = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item)
    return item
  }
  const material = (parameters: THREE.MeshStandardMaterialParameters) =>
    keep(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...parameters }))
  const box = (bw: number, bh: number, bd: number) => keep(new THREE.BoxGeometry(bw, bh, bd))

  const group = new THREE.Group()
  const parts = new THREE.Group()
  parts.position.x = -w / 2
  group.add(parts)

  const cloth = material({ color: cssColor(options.cloth) })
  const clothDeep = material({ color: cssColor(options.clothDeep) })
  const paper = material({ color: new THREE.Color(PAPER) })
  const edge = material({ color: new THREE.Color('#ded6c4') })

  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = parts) => {
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  add(new THREE.Mesh(box(w, h, BOARD), clothDeep)).position.set(w / 2, 0, -d / 2 + BOARD / 2)
  add(new THREE.Mesh(box(BOARD, h, d), clothDeep)).position.set(-BOARD / 2, 0, 0)

  const pageWidth = w - 6
  const pageHeight = h - 8
  add(
    new THREE.Mesh(box(pageWidth, pageHeight, d - BOARD * 2), [
      edge,
      edge,
      edge,
      edge,
      material({ map: keep(drawPage(7, true)) }),
      paper,
    ]),
  ).position.set(pageWidth / 2, 0, 0)

  const hinge = new THREE.Group()
  hinge.position.set(0, 0, d / 2 - BOARD / 2)
  parts.add(hinge)
  const coverMaterial = material({ color: cssColor(options.cloth) })
  const endpaper = material({ color: new THREE.Color('#e6dfce') })
  add(new THREE.Mesh(box(w, h, BOARD), [cloth, cloth, cloth, cloth, coverMaterial, endpaper]), hinge).position.x = w / 2

  const leaves = Array.from({ length: PAGES }, (_, i) => {
    const geometry = keep(new THREE.PlaneGeometry(pageWidth, pageHeight, SEGMENTS, 1))
    const front = keep(drawPage(31 + i * 17, true))
    const leaf = new THREE.Group()
    leaf.position.set(0, 0, d / 2 - BOARD + 0.6 + i * 0.12)
    add(new THREE.Mesh(geometry, material({ map: front, side: THREE.FrontSide })), leaf)
    add(new THREE.Mesh(geometry, material({ map: front, side: THREE.BackSide })), leaf)
    parts.add(leaf)
    bend(geometry, 0, pageWidth, 0)
    return { geometry, curl: 1.25 + ((i * 7) % 5) * 0.12 }
  })

  let openness = 0
  let latestCover = 0

  return {
    group,
    w,
    h,
    d,
    setOpen(next) {
      openness = next
      hinge.rotation.y = -next * (Math.PI - 0.03)
    },
    setTurns(progress) {
      const gate = Math.min(Math.max((openness - 0.7) / 0.3, 0), 1)
      leaves.forEach((leaf, i) => {
        const local = Math.min(Math.max((progress - i * 0.13) / 0.42, 0), 1)
        const eased = local < 0.5 ? 4 * local ** 3 : 1 - Math.pow(-2 * local + 2, 3) / 2
        bend(leaf.geometry, eased * gate, pageWidth, leaf.curl)
      })
    },
    applyCover(src) {
      const call = ++latestCover
      void (src ? loadImage(src) : Promise.resolve(null)).then((image) => {
        if (call !== latestCover) return
        let map: THREE.CanvasTexture
        try {
          map = drawCover(options.title, options.cloth, image)
          if (image) map.image.getContext('2d')!.getImageData(0, 0, 1, 1)
        } catch {
          map = drawCover(options.title, options.cloth, null)
        }
        coverMaterial.color.set(0xffffff)
        coverMaterial.map = keep(map)
        coverMaterial.needsUpdate = true
      })
    },
    dispose() {
      latestCover++
      for (const item of disposables) item.dispose()
    },
  }
}
