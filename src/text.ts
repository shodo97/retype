// Turns extracted book text into a flat list of typeable words.

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚‛′ʼ]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
  [/­/g, ''], // soft hyphen
  [/[​-‍⁠﻿]/g, ''], // zero-width characters
]

// Canonical book text: one paragraph per line, words separated by single spaces.
export function normalize(raw: string): string {
  let text = raw
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement)
  // NFKD splits ligatures (ﬁ -> fi) and accents (é -> e + mark); the marks are then dropped
  // so every word can be typed on a plain keyboard.
  text = text.normalize('NFKD').replace(/\p{M}/gu, '')
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.split(/\s+/).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n')
}

export type Book = {
  words: string[]
  starts: number[] // index of the first word of each paragraph
}

export function parseBook(canonical: string): Book {
  const words: string[] = []
  const starts: number[] = []
  for (const paragraph of canonical.split('\n')) {
    if (!paragraph) continue
    starts.push(words.length)
    for (const word of paragraph.split(' ')) words.push(word)
  }
  return { words, starts }
}

const SENTENCE_END = /[.!?]["')\]]*$/

// Start index of every passage, followed by words.length. A passage is about `size` words:
// it ends on the paragraph break nearest to that, or failing that on a sentence end.
export function passageBounds({ words, starts }: Book, size: number): number[] {
  const bounds = [0]
  let start = 0
  let p = 0
  while (start < words.length) {
    const nominal = start + size
    let end = Math.min(nominal, words.length)
    if (end < words.length) {
      const lo = start + Math.ceil(size * 0.6)
      const hi = Math.min(start + Math.floor(size * 1.5), words.length)
      while (p < starts.length && starts[p] < lo) p++
      let best = -1
      for (let q = p; q < starts.length && starts[q] <= hi; q++) {
        if (best < 0 || Math.abs(starts[q] - nominal) < Math.abs(best - nominal)) best = starts[q]
      }
      if (best >= 0) {
        end = best
      } else {
        for (let i = nominal - 1; i < hi; i++) {
          if (SENTENCE_END.test(words[i])) {
            end = i + 1
            break
          }
        }
      }
    }
    if (words.length - end < size / 4) end = words.length
    bounds.push(end)
    start = end
  }
  return bounds
}

// Index of the passage containing word `pos`, or -1 when pos is past the end.
export function passageAt(bounds: number[], pos: number): number {
  if (pos >= bounds[bounds.length - 1]) return -1
  let lo = 0
  let hi = bounds.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bounds[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}
