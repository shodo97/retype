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

// Index of the paragraph containing word `pos`.
export function paragraphAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}
