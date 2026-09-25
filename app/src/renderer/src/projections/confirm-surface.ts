// The host's CONFIRM SURFACE: a per-window modal that previews a wide-effect file operation's
// blast radius (the affected inbound-referrer files) before the caller commits it. A shared host
// capability, used by the file-tree's rename / delete / move.
//
//
//
// The surface renders a modal + an affected-file list; each row is cmd+hover-able, reusing the
// host PREVIEW surface for the peek (the caller passes its `previewPath` link-resolver). The
// surface performs NO mutation — `confirm()` resolves the user's decision, the caller acts on it.
// A per-window singleton, like the preview surface; it draws into a layer claimed from the host's
// OVERLAY SITE at the `overlay` band.

import type { AffectedRef, ConfirmOutcome, ConfirmRequest, ConfirmSurface } from './host-config'
import { getOverlaySite } from './overlay-site'
import { getPreviewSurface } from './preview-surface'
import { adoptHostSheet } from './adopt-sheet'

// The two z-indexes order this surface's own card and backdrop within its layer.
// Confirm claims `overlay`; preview claims the higher `popover` band so a preview remains above the dialog.
/* The <au-modal> element owns the CARD look (elev-5 header/body/actions shelf); the blast-radius rows are
   set elements (<au-accordion-item> / <au-list-row>, <au-code-block>, <au-badge>). The surface styles only the
   scrim, the card width, and how the composed body lays out. */
export const STYLE = `
.au-confirm-backdrop { pointer-events: auto; position: fixed; inset: 0; z-index: 50; background: var(--au-scrim, rgba(5, 4, 3, 0.62)); display: flex; align-items: center; justify-content: center; padding: var(--au-space-5, 20px); }
.au-confirm-card { z-index: 51; width: min(460px, 100%); max-height: calc(100vh - var(--au-space-7) * 2); }
/* Rows that expand to code context need the room for a readable line. */
.au-confirm-card[data-wide] { width: min(690px, 100%); }
.au-confirm-body { display: flex; flex-direction: column; gap: var(--au-space-3, 12px); }
.au-confirm-msg { margin: 0; color: var(--au-ink-2, #d9d6cd); }
.au-confirm-list { overflow: auto; max-height: 240px; }
div.au-confirm-list { border-radius: var(--au-radius-row); box-shadow: inset 0 0 0 1px var(--au-line-1); overflow: auto; }
.au-confirm-row-none { color: var(--au-ink-3); font-style: italic; }
.au-confirm-none { color: var(--au-ink-3, #a09c92); font-style: italic; }
.au-confirm-unknown { color: var(--au-color-warn); }
.au-confirm-hint { color: var(--au-ink-4, #959083); font-size: var(--au-t-2xs); line-height: var(--au-lh-2xs); }
`

// Vanilla-created <au-*> host-chrome atoms, typed STRUCTURALLY (set-independent). au-input carries a
// value + selectRange (partial select — the rename stem) + a spellcheck property; au-button emits
// au-activate (composed), so listen for that, not `click`.
type AuInputEl = HTMLElement & { value: string; spellcheck: boolean; selectRange(start: number, end: number): void }
type AuButtonEl = HTMLElement
type AuModalEl = HTMLElement & { heading: string }

/** Last path segment, for a compact row label (the full path is the row's title). */
function shortLabel(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** The addressing-form badge: 'by name' (stable on a move) vs 'by path' (the move rewrites it). Absent
 *  form → no badge, so the dialog never claims what it did not classify. */
function formBadge(ref: AffectedRef): HTMLElement | null {
  if (!ref.form) return null
  const badge = document.createElement('au-badge')
  badge.setAttribute('variant', 'label')
  if (ref.form === 'path') badge.setAttribute('tone', 'warn')
  badge.dataset.form = ref.form
  badge.textContent = ref.form === 'name' ? 'by name' : 'by path'
  return badge
}

/** A row that expands to the referencing line, numbered, with that line marked. */
function expandingRow(ref: AffectedRef): HTMLElement {
  const item = document.createElement('au-accordion-item') as HTMLElement & { value: string; label: string }
  item.value = ref.path
  item.label = shortLabel(ref.path)
  const badge = formBadge(ref)
  if (badge) {
    badge.slot = 'meta'
    item.appendChild(badge)
  }
  if (ref.context && ref.context.length > 0) {
    const code = document.createElement('au-code-block') as HTMLElement & { code: string; copy: boolean; lineStart: number; markLine?: number }
    code.copy = false
    code.lineStart = ref.contextStart ?? 1
    if (ref.line !== undefined) code.markLine = ref.line
    code.code = ref.context.join('\n')
    item.appendChild(code)
  } else {
    const none = document.createElement('div')
    none.className = 'au-confirm-row-none'
    none.textContent = 'The referencing line could not be read.'
    item.appendChild(none)
  }
  return item
}

/** A row with nothing to expand: the file, and its form badge. */
function plainRow(ref: AffectedRef): HTMLElement {
  const row = document.createElement('au-list-row') as HTMLElement & { primary: string }
  row.primary = shortLabel(ref.path)
  const badge = formBadge(ref)
  if (badge) {
    badge.slot = 'meta'
    row.appendChild(badge)
  }
  return row
}

export function createConfirmSurface(root: HTMLElement): ConfirmSurface {
  let styleInjected = false
  const ensureStyle = (): void => {
    if (styleInjected) return
    adoptHostSheet(STYLE) // host chrome as a document-level constructable sheet (CSP-exempt); lifetime
    styleInjected = true
  }

  function confirm(req: ConfirmRequest): Promise<ConfirmOutcome> {
    ensureStyle()
    return new Promise<ConfirmOutcome>((resolve) => {
      // A question withdrawn before it was shown resolves as a cancel and draws nothing.
      if (req.signal?.aborted) {
        resolve({ confirmed: false })
        return
      }
      const preview = getPreviewSurface()
      const backdrop = document.createElement('div')
      backdrop.className = 'au-confirm-backdrop'
      // The card LOOK is <au-modal> (elev-5 header/body/actions shelf).
      // Its body is a composed column (message + optional input + the blast-radius readout).
      const card = document.createElement('au-modal') as AuModalEl
      card.className = 'au-confirm-card'
      card.heading = req.title

      const body = document.createElement('div')
      body.className = 'au-confirm-body'
      const msg = document.createElement('p')
      msg.className = 'au-confirm-msg'
      msg.textContent = req.message
      body.appendChild(msg)

      let input: AuInputEl | null = null
      if (req.input) {
        input = document.createElement('au-input') as AuInputEl
        input.setAttribute('size', 'sm')
        input.spellcheck = false // a filename field — no spell squiggles
        input.value = req.input.value
        body.appendChild(input)
      }

      // THE BLAST RADIUS, in exactly three states. Each says one thing, and the dialog asserts
      // nothing the caller did not measure. A caller passes either the rich `affectedDetail` rows or
      // the plain `affected` paths; both derive the same three states from presence and length.
      const rows: AffectedRef[] | undefined = req.affectedDetail ?? req.affected?.map((path) => ({ path }))
      if (rows && rows.length > 0) {
        // Rows with context EXPAND to the referencing line in its surroundings, so the list is an
        // <au-accordion> (keyboard-operable, one disclosure per row). When any row expands, every row is an
        // item, so the list keeps one rhythm; a row whose line could not be read says so when opened. With
        // no context anywhere, nothing expands, and the rows are plain <au-list-row>s.
        const expands = rows.some((r) => r.context && r.context.length > 0)
        card.toggleAttribute('data-wide', expands)
        const list = document.createElement(expands ? 'au-accordion' : 'div')
        list.className = 'au-confirm-list'
        if (expands) {
          list.setAttribute('mode', 'multiple')
          list.setAttribute('density', 'compact')
        }
        for (const ref of rows) {
          const row = expands ? expandingRow(ref) : plainRow(ref)
          row.dataset.path = ref.path
          row.title = ref.path
          list.appendChild(row)
        }
        body.appendChild(list)

        if (req.previewContent) {
          const resolver = req.previewContent
          // cmd+hover a row → peek that file via the host preview surface. modHeld is read off the
          // move event (authoritative), so it can't stick if a keyup is missed.
          list.addEventListener('mousemove', (e) => {
            const row = (e.target as HTMLElement | null)?.closest('[data-path]') as HTMLElement | null
            const path = e.metaKey || e.ctrlKey ? row?.dataset.path : undefined
            if (!path) return
            const key = `confirm:${path}`
            if (preview.isShowing(key)) return
            preview.show(key, row!.getBoundingClientRect(), resolver(path), resolver)
          })
        }
        // Say what the rows do, only the interactions that are actually available.
        const hints = [expands ? 'Open a file to see the referencing line' : '', req.previewContent ? '⌘-hover a file to peek it' : ''].filter(Boolean)
        if (hints.length > 0) {
          const hint = document.createElement('div')
          hint.className = 'au-confirm-hint'
          hint.textContent = hints.join(' · ')
          body.appendChild(hint)
        }
      } else if (rows) {
        // An EMPTY array, so the caller looked and found none. This line is a CLAIM, and this is
        // the only state entitled to make it.
        const none = document.createElement('div')
        none.className = 'au-confirm-none'
        none.textContent = 'No other files reference this.'
        body.appendChild(none)
      } else if (req.unavailable) {
        // The caller tried and could not find out. Say so, in the caller's words. Silence here
        // would read as "nothing found", which is the whole failure this state exists to prevent:
        // an unmeasurable blast radius must never be presented as a measured empty one.
        const unknown = document.createElement('div')
        unknown.className = 'au-confirm-unknown'
        unknown.textContent = `Could not check which files reference this — ${req.unavailable}.`
        body.appendChild(unknown)
      }
      // No `affected` and no `unavailable`: a plain gate with no blast radius to report. Nothing.

      card.appendChild(body)

      // Actions → the <au-modal> `actions` slot (its hairline-topped footer). A destructive confirm's
      // affirmative uses the au-button `danger` variant (danger ink → fills danger); an ordinary one the
      // loud `cta`.
      const cancelBtn = document.createElement('au-button') as AuButtonEl
      cancelBtn.setAttribute('slot', 'actions')
      cancelBtn.setAttribute('size', 'sm')
      cancelBtn.setAttribute('variant', 'ghost')
      cancelBtn.textContent = 'Cancel'
      const okBtn = document.createElement('au-button') as AuButtonEl
      okBtn.setAttribute('slot', 'actions')
      okBtn.setAttribute('size', 'sm')
      okBtn.setAttribute('variant', req.danger ? 'danger' : 'cta')
      okBtn.textContent = req.confirmLabel
      card.append(cancelBtn, okBtn)

      backdrop.appendChild(card)
      root.appendChild(backdrop)

      if (input) {
        // Select the stem, not the extension (focuses the inner field first).
        const dot = input.value.lastIndexOf('.')
        input.selectRange(0, dot > 0 ? dot : input.value.length)
      } else {
        okBtn.focus()
      }

      let settled = false
      const onAbort = (): void => close({ confirmed: false })
      const close = (outcome: ConfirmOutcome): void => {
        if (settled) return
        settled = true
        req.signal?.removeEventListener('abort', onAbort)
        document.removeEventListener('keydown', onKey, true)
        preview.hide() // drop any lingering peek this dialog raised
        backdrop.remove()
        resolve(outcome)
      }
      const doConfirm = (): void => {
        const value = input ? input.value.trim() : undefined
        if (input && (!value || value.includes('/'))) return // invalid name — keep the dialog open
        close({ confirmed: true, value })
      }
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close({ confirmed: false })
        } else if (e.key === 'Enter') {
          // Enter on a row's own control (an expanding row's trigger) belongs to that row; it must never
          // commit the operation the dialog is asking about.
          if (e.composedPath().some((n) => n instanceof HTMLElement && n.classList.contains('au-confirm-list'))) return
          e.preventDefault()
          doConfirm()
        }
      }
      cancelBtn.addEventListener('au-activate', () => close({ confirmed: false }))
      okBtn.addEventListener('au-activate', doConfirm)
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close({ confirmed: false })
      })
      document.addEventListener('keydown', onKey, true)
      req.signal?.addEventListener('abort', onAbort)
    })
  }

  return { confirm }
}

// Per-window singleton (each renderer window has its own module state), like getPreviewSurface.
//
// The layer is claimed once and never released. A dialog is transient but this surface is not: it
// creates and removes a backdrop per `confirm()` call, inside a layer that stays.
//
// THE LAYER DOES NOT CAPTURE — the BACKDROP does, and the distinction is load-bearing. A modal must
// swallow clicks on everything beneath it, but only WHILE IT IS OPEN. A permanently-claimed layer
// that captured would be a full-viewport sheet over the app at all times, so every click in the
// composition would die on an empty overlay. The backdrop already covers `inset: 0` and already
// exists only for the life of one dialog, so it is the honest place for `pointer-events: auto`.
let singleton: ConfirmSurface | null = null
export function getConfirmSurface(): ConfirmSurface {
  return (singleton ??= createConfirmSurface(getOverlaySite().claim({ level: 'overlay' }).el))
}
