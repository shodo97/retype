// Cover images. One taken from the book's own file is kept in this browser; failing that,
// Open Library is asked for one by title. Either way it is remembered per book.
import { useEffect, useSyncExternalStore } from 'react'

const key = (id: string) => `retype.cover.${id}`
const WIDTH = 480

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// A data: URL, '' when a search found nothing, or null when not looked for yet.
export const loadCover = (id: string) => localStorage.getItem(key(id))

export function saveCover(id: string, cover: string) {
  try {
    localStorage.setItem(key(id), cover)
  } catch {
    // Storage is full. The book keeps its cloth cover.
  }
  listeners.forEach((listener) => listener())
}

export function forgetCover(id: string) {
  localStorage.removeItem(key(id))
}

// File names carry clutter that is not part of the title: "[Series] Author - Title - site.tld".
function searchTerms(title: string) {
  return title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b[\w-]+\.(li|org|com|net|is|rs|io)\b/gi, ' ')
    .replace(/\b(libgen|z-?lib(rary)?|epub|pdf|retail|ebook)\b/gi, ' ')
    .replace(/[_\-–—:;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const searching = new Set<string>()

async function search(id: string, title: string) {
  if (searching.has(id)) return
  searching.add(id)
  try {
    const query = new URLSearchParams({ q: searchTerms(title), fields: 'cover_i', limit: '5' })
    const response = await fetch(`https://openlibrary.org/search.json?${query}`)
    const { docs } = (await response.json()) as { docs: { cover_i?: number }[] }
    const found = docs.find((doc) => doc.cover_i)?.cover_i
    if (!found) return saveCover(id, '')
    // Their image server is slow, so keep a copy rather than the address.
    const image = await fetch(`https://covers.openlibrary.org/b/id/${found}-L.jpg`)
    if (!image.ok) throw new Error(image.statusText)
    const bitmap = await createImageBitmap(await image.blob())
    saveCover(id, looksLikeCover(bitmap) ? shrink(bitmap, bitmap.width, bitmap.height) : '')
  } catch {
    // Offline or blocked: try again next visit.
  } finally {
    searching.delete(id)
  }
}

export function useCover(id: string, title: string): string | undefined {
  const cover = useSyncExternalStore(subscribe, () => loadCover(id))
  useEffect(() => {
    if (cover === null) void search(id, title)
  }, [id, title, cover])
  return cover || undefined
}

function shrink(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = Math.round((WIDTH * height) / width)
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

// Search results include blank placeholders and scans of a whole jacket laid flat. A cloth
// cover is better than either.
function looksLikeCover(bitmap: ImageBitmap) {
  const shape = bitmap.width / bitmap.height
  if (shape < 0.55 || shape > 0.85) return false
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, 16, 16)
  const { data } = ctx.getImageData(0, 0, 16, 16)
  let lightest = 0
  let darkest = 255
  for (let i = 0; i < data.length; i += 4) {
    const light = (data[i] + data[i + 1] + data[i + 2]) / 3
    lightest = Math.max(lightest, light)
    darkest = Math.min(darkest, light)
  }
  return lightest - darkest > 40
}

async function fromImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  return shrink(bitmap, bitmap.width, bitmap.height)
}

// The first page of a PDF is its cover.
async function fromPdf(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { default: workerSrc } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  try {
    const page = await doc.getPage(1)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: WIDTH / natural.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    await doc.destroy()
  }
}

// An EPUB names its cover in the package file, in one of two ways.
async function fromEpub(file: File) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()
  const container = await zip.file('META-INF/container.xml')?.async('string')
  if (!container) return undefined
  const opfPath = parser
    .parseFromString(container, 'application/xml')
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path')
  const opfXml = opfPath && (await zip.file(opfPath)?.async('string'))
  if (!opfPath || !opfXml) return undefined
  const opf = parser.parseFromString(opfXml, 'application/xml')
  const items = [...opf.getElementsByTagNameNS('*', 'item')]
  const named = [...opf.getElementsByTagNameNS('*', 'meta')]
    .find((meta) => meta.getAttribute('name') === 'cover')
    ?.getAttribute('content')
  const isImage = (item: Element) => (item.getAttribute('media-type') ?? '').startsWith('image/')
  const item =
    items.find((i) => (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')) ??
    items.find((i) => i.getAttribute('id') === named && isImage(i)) ??
    items.find((i) => isImage(i) && /cover/i.test(`${i.getAttribute('id')} ${i.getAttribute('href')}`))
  const href = item?.getAttribute('href')
  if (!href) return undefined
  const path = decodeURIComponent(new URL(href, `http://epub/${opfPath}`).pathname.slice(1))
  const blob = await zip.file(path)?.async('blob')
  return blob && fromImage(blob)
}

// A cover from a picture, or from the front of a PDF or EPUB.
export async function coverFromFile(file: File): Promise<string | undefined> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (file.type.startsWith('image/')) return fromImage(file)
  if (ext === 'pdf' || file.type === 'application/pdf') return fromPdf(file)
  if (ext === 'epub' || file.type === 'application/epub+zip') return fromEpub(file)
  return undefined
}
