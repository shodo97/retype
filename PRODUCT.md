# Product

## Register

product. The signed-out landing page alone is brand register: a single-canvas, virtual-scroll WebGL experience ("the midnight study") in the manner of why.zero.university — six acts, interaction gates, text rendered inside the scene, one book as the only lit object. Reference bar: BUNQ LABS' Zero site (stage segments, gesture gates, in-GL typography, per-beat shader set-pieces, subtle sound).

## Landing Narrative — "Reading that stays" (six acts)

The argument, told in second person, calm but polarizing: aimed at the culture of fast reading, never at the reader. Gates make the visitor perform the thesis instead of reading it.

- **Gate — Type `read` to begin.** A dark desk, one caret. Each correct keystroke lights a lamp. (Enter = watch instead; touch devices hold instead.)
- **I · The Flood.** A blizzard of ephemeral words streams past: "You will read a hundred thousand words today." Feeds, captions, summaries of summaries.
- **II · The Vanishing.** A real page of Walden sets itself, is "read" by a sweeping eye, and smokes away behind the sweep. Gate: hold the last line before it goes. What you hold, stays.
- **III · The Hands.** "What the hand writes, the mind keeps." Gate: type "Simplify, simplify" — each letter falls as ink and beds into a page. A copied page is read twice.
- **IV · The Book.** The hardback assembles, opens under lamplight, pages turn with the scroll. Bring your own book; your place is kept to the word; no words-per-minute while you read.
- **V · The Tunnel.** Into the open page: lines of the book streaming past. Twenty minutes a night, a book a season, every word through your hands.
- **VI · The Desk.** The book settles. "The book is on the desk." Type a page (live demo), sign in.

A quiet "words kept" counter ticks at each gate (the honest XP). The progress ruler reads as chapters, I through VI. Sound is procedural WebAudio, ambient and very quiet, starting only after the first gesture, with a visible toggle.

## Users

Readers and typists who want to practise typing on text worth reading. They bring their own book (PDF, EPUB or plain text) and retype it from the first word to the last, a session at a time, usually at a desk with a real keyboard. Sessions are long and quiet: twenty minutes to an hour, often daily. Newcomers arrive without context and need to understand in a few seconds what retype is and why retyping a book is worth doing.

## Product Purpose

retype is a slower way to read: you retype a book word by word, so every word passes through your hands and none is skimmed. It keeps your place, records speed and accuracy honestly but quietly, and syncs progress to your account. Success is a reader who returns the next day and picks up exactly where they stopped, who finishes a book, and who remembers it. Comprehension is the point; velocity is a by-product.

The name is the act itself: you retype the book.

## Brand Personality

Calm, literate, exacting. The voice is a well-edited book's colophon: short, plain, confident, never chatty or gamified. The interface should feel like a finely printed page that happens to respond to the keyboard. Emotional goals: focus while typing, quiet satisfaction at the end of a session, pride in a growing shelf.

## Anti-references

- Monkeytype and its clones: dark gray, monospace, neon accent, stats-first.
- Gamified typing trainers: streak flames, confetti, leaderboards, badges.
- SaaS dashboards: card grids, hero metrics, gradient accents, glass panels.

## Design Principles

0. **The book is an object.** Books appear as physical, three-dimensional volumes. Opening one is an event: it lifts, the cover swings open, the pages flutter, and the page you type on arrives. This is the one place motion is allowed to be theatrical.

1. **The text is the interface.** While typing, nothing competes with the page. Chrome recedes; numbers wait until asked for.
2. **Set it like a book.** Typographic decisions follow print conventions (measure, leading, small caps, old-style figures) before they follow app conventions.
3. **Ink only, and lamplight after dark.** Inside the app the palette is paper and ink; the one colour is a proofreader's crimson, used only for mistakes and destructive actions. No orange, no decorative accent. The landing page is the exception: a deep umber night in which warm amber appears only as light (lamplight pools, the lit book, a glowing caret), never as a UI accent.
4. **Keyboard first, always.** Every action in a session is reachable without leaving the home row, and shortcuts are shown where they apply.
5. **Honest numbers, quietly stated, and late.** While typing, the reader sees only the words and how long they have been with the book. Speed and accuracy wait for the end of the session, where they are precise and legible, never celebratory. retype is not a words-per-minute trainer.

## Accessibility & Inclusion

WCAG 2.1 AA. Text and error states must not rely on color alone (errors are also underlined). Full keyboard operation with visible focus. Honors `prefers-reduced-motion` and `prefers-color-scheme`, with a manual light/dark override.
