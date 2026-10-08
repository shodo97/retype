// Type that lives inside the scene. Lines of Literata are drawn to canvases, carried on
// planes, and given to a shader that can breathe them in and smoke them away: the whole
// argument of the landing page is made with this material.
import * as THREE from 'three'

export const SERIF = '"Literata Variable", "Iowan Old Style", Georgia, serif'

export type TextStyle = {
  size: number // CSS px
  weight?: number
  italic?: boolean
  letterSpacing?: number // em
  color?: string // canvas is drawn white when omitted; the shader tints
}

const SCALE = 2 // canvas pixels per CSS px, for crisp glyphs

function font(style: TextStyle, px: number) {
  return `${style.italic ? 'italic ' : ''}${style.weight ?? 400} ${px}px ${SERIF}`
}

export function measure(text: string, style: TextStyle) {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = font(style, style.size)
  return ctx.measureText(text).width + (style.letterSpacing ?? 0) * style.size * Math.max(text.length - 1, 0)
}

// Greedy wrap into lines no wider than maxWidth CSS px.
export function wrap(text: string, style: TextStyle, maxWidth: number): string[] {
  const lines: string[] = []
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1]
    if (last !== undefined && measure(`${last} ${word}`, style) <= maxWidth) {
      lines[lines.length - 1] = `${last} ${word}`
    } else lines.push(word)
  }
  return lines
}

function drawText(text: string, style: TextStyle) {
  const px = style.size * SCALE
  const spacing = (style.letterSpacing ?? 0) * px
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = font(style, px)
  const metrics = ctx.measureText(text)
  const ascent = metrics.actualBoundingBoxAscent || px * 0.8
  const descent = metrics.actualBoundingBoxDescent || px * 0.25
  const pad = Math.ceil(px * 0.18)
  canvas.width = Math.max(2, Math.ceil(metrics.width + spacing * Math.max(text.length - 1, 0)) + pad * 2)
  canvas.height = Math.max(2, Math.ceil(ascent + descent) + pad * 2)
  ctx.font = font(style, px)
  ctx.fillStyle = style.color ?? '#ffffff'
  ctx.textBaseline = 'alphabetic'
  if (spacing > 0) {
    let x = pad
    for (const ch of text) {
      ctx.fillText(ch, x, pad + ascent)
      x += ctx.measureText(ch).width + spacing
    }
  } else {
    ctx.fillText(text, pad, pad + ascent)
  }
  return canvas
}

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  map.minFilter = THREE.LinearMipmapLinearFilter
  return map
}

// Value-noise FBM, enough texture for smoke without costing much.
const NOISE = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.5 * vnoise(p);
    v += 0.25 * vnoise(p * 2.03);
    v += 0.125 * vnoise(p * 4.09);
    return v / 0.875;
  }
`

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// uReveal fades the line in; uDissolve smokes it away through a noise threshold with a warm
// burn edge and an upward drift, as if the ink were becoming air.
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform vec3 uWarm;
  uniform float uOpacity;
  uniform float uReveal;
  uniform float uDissolve;
  uniform float uTime;
  uniform float uNoise;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float d = uDissolve;
    vec2 drift = vec2(
      (vnoise(vUv * 3.0 + uTime * 0.05) - 0.5) * 0.12,
      -0.16 * (vnoise(vUv * 2.0 + 7.0) * 0.5 + 0.5)
    ) * d;
    float glyph = texture2D(uMap, vUv + drift).a;
    float n = fbm(vUv * uNoise + vec2(0.0, uTime * 0.03));
    // Ink survives where the noise still sits above the rising threshold.
    float t = d * 1.3 - 0.12;
    float solid = smoothstep(t, t + 0.1, n);
    float rim = smoothstep(t - 0.05, t + 0.02, n) * (1.0 - smoothstep(t + 0.04, t + 0.14, n));
    float alpha = glyph * solid * uOpacity * uReveal;
    vec3 col = uColor + uWarm * rim * step(0.001, d) * 1.6;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col, alpha);
  }
`

export type TextPlaneOptions = {
  color?: THREE.ColorRepresentation
  warm?: THREE.ColorRepresentation
  noise?: number
}

// One line of type on a plane, one world unit per CSS pixel.
export class TextPlane {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  width: number
  height: number
  private map: THREE.CanvasTexture
  private geometry: THREE.PlaneGeometry

  constructor(text: string, style: TextStyle, options: TextPlaneOptions = {}) {
    const canvas = drawText(text, style)
    this.map = texture(canvas)
    this.width = canvas.width / SCALE
    this.height = canvas.height / SCALE
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMap: { value: this.map },
        uColor: { value: new THREE.Color(options.color ?? '#efe3c8') },
        uWarm: { value: new THREE.Color(options.warm ?? '#ffb15e') },
        uOpacity: { value: 1 },
        uReveal: { value: 0 },
        uDissolve: { value: 0 },
        uTime: { value: 0 },
        uNoise: { value: options.noise ?? 6 },
      },
    })
    this.geometry = new THREE.PlaneGeometry(this.width, this.height)
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.renderOrder = 10
  }

  set reveal(v: number) {
    this.material.uniforms.uReveal.value = v
  }
  get reveal() {
    return this.material.uniforms.uReveal.value as number
  }
  set dissolve(v: number) {
    this.material.uniforms.uDissolve.value = v
  }
  get dissolve() {
    return this.material.uniforms.uDissolve.value as number
  }
  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v
  }
  tick(time: number) {
    this.material.uniforms.uTime.value = time
  }
  setColor(c: THREE.ColorRepresentation) {
    ;(this.material.uniforms.uColor.value as THREE.Color).set(c)
  }
  dispose() {
    this.map.dispose()
    this.material.dispose()
    this.geometry.dispose()
  }
}

// Cached single-glyph textures for letters that fall as ink.
const glyphCache = new Map<string, { map: THREE.CanvasTexture; width: number; height: number }>()

export function glyphSprite(char: string, style: TextStyle, color: THREE.ColorRepresentation) {
  const key = `${char}:${style.size}:${style.weight}:${style.italic}`
  let entry = glyphCache.get(key)
  if (!entry) {
    const canvas = drawText(char, style)
    entry = { map: texture(canvas), width: canvas.width / SCALE, height: canvas.height / SCALE }
    glyphCache.set(key, entry)
  }
  const material = new THREE.SpriteMaterial({
    map: entry.map,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color(color),
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(entry.width, entry.height, 1)
  return sprite
}

// Word textures for the flood; shared maps, per-sprite materials for opacity.
const wordCache = new Map<string, THREE.CanvasTexture>()

export function wordSprite(word: string, style: TextStyle, color: THREE.ColorRepresentation) {
  const key = `${word}:${style.size}:${style.italic}`
  let map = wordCache.get(key)
  if (!map) {
    map = texture(drawText(word, style))
    wordCache.set(key, map)
  }
  const image = map.image as HTMLCanvasElement
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
    color: new THREE.Color(color),
    opacity: 0,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(image.width / SCALE, image.height / SCALE, 1)
  return sprite
}

export function disposeTextCaches() {
  for (const { map } of glyphCache.values()) map.dispose()
  glyphCache.clear()
  for (const map of wordCache.values()) map.dispose()
  wordCache.clear()
}
