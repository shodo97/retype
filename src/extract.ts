// Text extraction for uploaded books. The parsers are loaded on demand.

export type Extracted = { title: string; text: string }
type Progress = (message: string) => void

export async function extract(file: File, onProgress: Progress): Promise<Extracted> {
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '')
  const ext = file.name.split('.').pop()?.toLowerCase()
  let result: { title?: string; text: string }
  if (ext === 'pdf' || file.type === 'application/pdf') result = await extractPdf(file, onProgress)
  else if (ext === 'epub' || file.type === 'application/epub+zip') result = await extractEpub(file, onProgress)
  else if (ext === 'txt' || file.type === 'text/plain') result = { text: plainText(await file.text()) }
  else throw new Error('Unsupported file type. Upload a PDF, EPUB or TXT file.')
  return { title: result.title?.trim() || fallbackTitle, text: result.text }
}

// In the returned text every newline is a paragraph break.
function plainText(raw: string) {
  const text = raw.replace(/\r\n?/g, '\n')
  // With blank lines between paragraphs, single newlines are just hard wrapping.
  if (!/\n[ \t]*\n/.test(text)) return text
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, ' '))
    .join('\n')
}

type Line = { text: string; x: number; y: number; right: number; height: number }

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]

function mostCommon(values: number[]) {
  const counts = new Map<number, number>()
  let best = values[0]
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count > counts.get(best)!) best = value
  }
  return best
}

// PDFs only store positioned lines, so paragraphs are inferred from the layout: a first-line
// indent, extra vertical space, or a short line that ends a sentence.
// Returns, per line, whether it starts a new paragraph, plus whether the page's last line
// ends one.
function pageParagraphBreaks(lines: Line[]) {
  const left = mostCommon(lines.map((l) => Math.round(l.x)))
  const right = Math.max(...lines.map((l) => l.right))
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((gap) => gap > 0)
  const gap = gaps.length ? median(gaps) : 0
  const endsEarly = (l: Line) =>
    l.right < right - (right - left) * 0.08 && /[.!?:]["'’”)\]]*$/.test(l.text.trim())
  const breaks = lines.map((line, i) => {
    const prev = lines[i - 1]
    const indented = line.x - left > line.height * 0.5
    if (!prev) return indented
    const drop = prev.y - line.y
    return indented || drop < 0 || (gap > 0 && drop > gap * 1.4) || endsEarly(prev)
  })
  return { breaks, endsParagraph: endsEarly(lines[lines.length - 1]) }
}

async function extractPdf(file: File, onProgress: Progress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { default: workerSrc } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  try {
    const paragraphs: string[] = []
    let pendingBreak = true
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(`extracting page ${n} / ${doc.numPages}`)
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const lines: Line[] = []
      let line: Line | null = null
      const flush = () => {
        // Drop empty lines and lines that are only a page number.
        if (line && line.text.trim() && !/^\s*\d+\s*$/.test(line.text)) lines.push(line)
        line = null
      }
      for (const item of content.items) {
        if (!('str' in item)) continue
        const x = item.transform[4]
        if (item.str.trim()) {
          line ??= { text: '', x, y: item.transform[5], right: x, height: item.height }
          line.right = x + item.width
        }
        if (line) line.text += item.str
        if (item.hasEOL) flush()
      }
      flush()
      page.cleanup()
      if (!lines.length) continue

      const { breaks, endsParagraph } = pageParagraphBreaks(lines)
      // A paragraph can run over the page break. Pages with only a few lines (title pages,
      // dedications) have no layout to judge by, so they always stand alone.
      const sparse = lines.length < 5
      if (pendingBreak || sparse) breaks[0] = true
      lines.forEach((l, i) => {
        const text = l.text.trim()
        const last = paragraphs.length - 1
        if (breaks[i] || last < 0) paragraphs.push(text)
        // Rejoin words that were hyphenated across a line break.
        else if (/\p{L}[-­‐]$/u.test(paragraphs[last]) && /^\p{Ll}/u.test(text))
          paragraphs[last] = paragraphs[last].slice(0, -1) + text
        else paragraphs[last] += ' ' + text
      })
      pendingBreak = endsParagraph || sparse
    }
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string } | undefined
    return { title: info?.Title, text: paragraphs.join('\n') }
  } finally {
    await doc.destroy()
  }
}

const BLOCK_TAGS = new Set(
  'address article aside blockquote br dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li ol p pre section table td th tr ul'.split(
    ' ',
  ),
)
const SKIPPED_TAGS = new Set(['script', 'style', 'head', 'nav', 'svg', 'math'])

function collectText(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.nodeValue ?? '')
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const tag = (node as Element).localName.toLowerCase()
  if (SKIPPED_TAGS.has(tag)) return
  // Footnote markers would otherwise glue themselves onto the preceding word.
  if (tag === 'sup' && /^[\s\d[\]()*]*$/.test(node.textContent ?? '')) return
  const block = BLOCK_TAGS.has(tag)
  if (block) out.push('\n')
  node.childNodes.forEach((child) => collectText(child, out))
  if (block) out.push('\n')
}

async function extractEpub(file: File, onProgress: Progress) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()
  const read = (path: string) => zip.file(path)?.async('string')

  const containerXml = await read('META-INF/container.xml')
  if (!containerXml) throw new Error('This does not look like a valid EPUB file.')
  const opfPath = parser
    .parseFromString(containerXml, 'application/xml')
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path')
  const opfXml = opfPath && (await read(opfPath))
  if (!opfPath || !opfXml) throw new Error('This does not look like a valid EPUB file.')
  const opf = parser.parseFromString(opfXml, 'application/xml')

  const manifest = new Map<string, Element>()
  for (const item of opf.getElementsByTagNameNS('*', 'item')) manifest.set(item.getAttribute('id') ?? '', item)

  const chapters: string[] = []
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    const href = item?.getAttribute('href')
    if (!item || !href) continue
    if (!(item.getAttribute('media-type') ?? '').includes('html')) continue
    if ((item.getAttribute('properties') ?? '').split(/\s+/).includes('nav')) continue
    // Chapter hrefs are relative to the OPF file.
    chapters.push(decodeURIComponent(new URL(href, `http://epub/${opfPath}`).pathname.slice(1)))
  }

  const parts: string[] = []
  for (let i = 0; i < chapters.length; i++) {
    onProgress(`extracting chapter ${i + 1} / ${chapters.length}`)
    const markup = await read(chapters[i])
    if (!markup) continue
    let doc = parser.parseFromString(markup, 'application/xhtml+xml')
    if (doc.querySelector('parsererror')) doc = parser.parseFromString(markup, 'text/html')
    const out: string[] = []
    collectText(doc.querySelector('body') ?? doc.documentElement, out)
    parts.push(out.join(''))
  }

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent ?? undefined
  return { title, text: parts.join('\n') }
}
