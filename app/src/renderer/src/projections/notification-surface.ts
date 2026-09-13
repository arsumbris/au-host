// The host owns a per-window notification frame and registers it as a `ui-notification` broadcast
// handler, including when no composition is mounted. A type-keyed registry chooses plugin content
// renderers; the default renderer shows severity, message, and actions. The host owns positioning,
// lifetime, and dismissal, drawing through the overlay site's `toast` band.

import type { IntentPayload } from './host-config'
import { getOverlaySite } from './overlay-site'
import { adoptHostSheet } from './adopt-sheet'

type Severity = 'info' | 'warn' | 'error'

/** The host reads only these fields off a fired `ui-notification` (the vocab lives in
 *  `@arsumbris/intent`; the host keeps a local minimal shape rather than depend on it). */
interface NotificationPayload {
  type: string
  severity?: Severity
  message?: string
  actions?: { label?: string; intent?: unknown }[]
}

/**
 * Draw notification content into a host-owned element. The host owns its frame and lifecycle.
 * `fireAction` fires an embedded intent through the channel; the type registry selects the content renderer.
 */
export type NotificationContentRenderer = (
  n: NotificationPayload,
  el: HTMLElement,
  fireAction: (intent: unknown) => void,
) => void

/** The host notification surface: the runtime calls `show` on each fired notification. */
export interface NotificationSurface {
  show(notification: IntentPayload, fireAction: (intent: unknown) => void): void
}

const AUTO_DISMISS_MS = 5000
const COLLAPSED_VISIBLE_COUNT = 5

export const STYLE = `
/* No z-index: the overlay SITE places this at the \`toast\` band, and inside its own layer there is
   nothing to order against. \`pointer-events: none\` stays — it is inherited, and the bounded scroller
   re-enables input so its native scrollbar remains reachable. */
/* The VIEWPORT bounds the stack to the window height and scrolls when the toasts overflow it, so a
   tall stack never runs off the bottom of the screen. The overlay COLUMN + each toast's LIFECYCLE
   wrapper only. The toast LOOK is <au-toast> (elev-5 card + tone dot, no bar),
   drawn by the default renderer. The wrapper is a bare, click-catching host the frame animates OUT
   on dismiss. */
.au-notif-viewport {
  position: fixed; top: var(--au-space-3); right: var(--au-space-3);
  width: min(360px, calc(100vw - var(--au-space-3) * 2));
  max-height: calc(100dvh - var(--au-space-3) * 2);
  max-width: min(360px, calc(100vw - var(--au-space-3) * 2));
  pointer-events: none;
}
.au-notif-viewport:not(:has(.au-notif-toast)) { display: none; }
.au-notif-viewport::part(scroll) {
  box-sizing: border-box;
  overscroll-behavior: contain;
  pointer-events: auto;
}
.au-notif-viewport::part(scroll):focus-visible { outline: 1px solid var(--au-focus-outer); outline-offset: -1px; }
@media (forced-colors: active) { .au-notif-viewport::part(scroll):focus-visible { outline-color: Highlight; } }
.au-notif-overlay {
  display: flex; flex-direction: column; gap: var(--au-space-2);
  max-width: min(360px, calc(100vw - var(--au-space-3) * 2)); pointer-events: none;
  font: var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans);
}
.au-notif-toast { pointer-events: auto; min-height: 0; animation: au-notif-in var(--au-m-base) var(--au-e-soft) both; }
.au-notif-toast:focus-visible { outline: 1px solid var(--au-focus-outer); outline-offset: -1px; border-radius: var(--au-radius-panel); }
.au-notif-toast au-toast::part(toast) { animation: none; }
@keyframes au-notif-in { from { opacity: 0; } to { opacity: 1; } }
.au-notif-toast[hidden], .au-notif-more[hidden] { display: none; }
.au-notif-toast.leaving { animation: none; opacity: 0; height: 0 !important; margin-bottom: calc(-1 * var(--au-space-2)); overflow: clip; transition: opacity var(--au-m-fast) var(--au-e-std), height var(--au-m-base) var(--au-e-soft), margin-bottom var(--au-m-base) var(--au-e-soft); }
.au-notif-more { pointer-events: auto; align-self: stretch; }
@media (prefers-reduced-motion: reduce) { .au-notif-toast { animation: none; } .au-notif-toast.leaving { transition: none; } }
`

// Notification severity → <au-toast> tone (a leading status dot). info → the ink default (no attr).
const TOAST_TONE: Partial<Record<Severity, string>> = { warn: 'warn', error: 'danger' }

function severityOf(n: NotificationPayload): Severity {
  return n.severity === 'warn' || n.severity === 'error' ? n.severity : 'info'
}

/** The host-shipped DEFAULT content renderer: one <au-toast> — a tone dot +
 *  the message as its heading + any actions in the trailing `action` slot + the built-in × close. */
const defaultRenderer: NotificationContentRenderer = (n, el, fireAction) => {
  const sev = severityOf(n)
  const toast = document.createElement('au-toast') as HTMLElement & { heading: string }
  toast.heading = n.message ?? ''
  const tone = TOAST_TONE[sev]
  if (tone) toast.setAttribute('tone', tone)
  // The × emits au-close; the frame (below) dismisses on it.

  for (const action of n.actions ?? []) {
    const btn = document.createElement('au-button')
    btn.setAttribute('slot', 'action')
    btn.setAttribute('size', 'sm')
    btn.setAttribute('variant', 'ghost') // a quiet trailing action
    btn.textContent = action.label ?? 'Action'
    btn.dataset.role = 'dismiss' // activating an action also dismisses the toast (frame delegation below)
    btn.addEventListener('au-activate', () => {
      if (action.intent && typeof action.intent === 'object') fireAction(action.intent)
    })
    toast.appendChild(btn)
  }
  el.appendChild(toast)
}

// The type-keyed content-renderer registry: a fired notification's `type` selects its
// renderer; the base `ui-notification` (absent here) uses `defaultRenderer`. Populated by
// `setNotificationRenderers`, driven by the host's `subtypes('ui-notification')` discovery. Module
// state (per-window), like the surface singleton.
const renderers = new Map<string, NotificationContentRenderer>()

/** Install the discovered content renderers, keyed by `ui-notification` (sub)type name. Replaces
 *  the prior set (a re-discovery is authoritative). The base type keeps the default renderer. */
export function setNotificationRenderers(next: Map<string, NotificationContentRenderer>): void {
  renderers.clear()
  for (const [type, fn] of next) renderers.set(type, fn)
}

function createNotificationSurface(root: HTMLElement): NotificationSurface {
  let overlay: HTMLElement | null = null
  let expanded = false
  let more: HTMLElement | null = null
  let returnFocus: HTMLElement | null = null
  const active = new Map<HTMLElement, () => void>()

  function focusRemaining(exclude?: HTMLElement): void {
    const next = [...active.keys()].find(card => card !== exclude && !card.hidden && !card.inert)
    if (next) next.focus({ preventScroll: true })
    else if (returnFocus?.isConnected && returnFocus.checkVisibility()) returnFocus.focus({ preventScroll: true })
  }

  function updateStack(): void {
    const cards = [...active.keys()]
    cards.forEach((card, index) => {
      const hidden = !expanded && index >= COLLAPSED_VISIBLE_COUNT
      if (card.hidden !== hidden) {
        card.hidden = hidden
        active.get(card)?.()
      }
    })
    if (!more) return
    const overflow = cards.length - COLLAPSED_VISIBLE_COUNT
    const hadFocus = more.matches(':focus-within')
    more.hidden = overflow <= 0
    if (more.hidden && hadFocus) focusRemaining()
    more.textContent = expanded ? 'Show fewer notifications' : `${overflow} more ${overflow === 1 ? 'notification' : 'notifications'}`
    more.setAttribute('aria-expanded', String(expanded))
    if (!cards.length) expanded = false
  }

  function ensureOverlay(): HTMLElement {
    if (overlay) return overlay
    const el = document.createElement('div')
    el.className = 'au-notif-overlay'
    adoptHostSheet(STYLE) // host chrome as a document-level constructable sheet (CSP-exempt); lifetime
    // The bounded scroller: caps the stack to the window height and scrolls the overflow, so a tall
    // run of toasts never leaves the screen. The column lives inside it; the viewport owns the frame.
    const viewport = document.createElement('au-scroll-area') as HTMLElement & {
      updateComplete: Promise<unknown>
      scrollElement: HTMLElement | null
    }
    viewport.className = 'au-notif-viewport'
    viewport.setAttribute('axis', 'y')
    viewport.appendChild(el)
    more = document.createElement('au-button')
    more.className = 'au-notif-more'
    more.setAttribute('variant', 'outline')
    more.setAttribute('size', 'sm')
    more.hidden = true
    more.addEventListener('au-activate', () => { expanded = !expanded; updateStack() })
    el.appendChild(more)
    root.appendChild(viewport)
    void viewport.updateComplete.then(() => {
      const scroller = viewport.scrollElement
      if (!scroller) return
      scroller.tabIndex = 0
      scroller.setAttribute('role', 'region')
      scroller.setAttribute('aria-label', 'Notifications')
    })
    overlay = el
    return el
  }

  function show(notification: IntentPayload, fireAction: (intent: unknown) => void): void {
    const n = notification as unknown as NotificationPayload
    const host = ensureOverlay()
    let focused = document.activeElement
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement
    if (focused instanceof HTMLElement && !root.matches(':focus-within')) returnFocus = focused

    const card = document.createElement('div')
    card.className = 'au-notif-toast' // a bare lifecycle wrapper; the <au-toast> inside is the look
    card.tabIndex = -1

    // Type-keyed CONTENT SLOT: a subtype's discovered renderer draws into the host frame; the base
    // type (and any unregistered type) uses the host default. The frame + lifecycle stay the host's.
    const render = renderers.get(n.type) ?? defaultRenderer
    render(n, card, fireAction)
    host.insertBefore(card, more)

    let timer = window.setTimeout(dismiss, AUTO_DISMISS_MS)
    let dismissed = false
    function dismiss(): void {
      if (dismissed) return
      dismissed = true
      window.clearTimeout(timer)
      if (card.matches(':focus-within')) focusRemaining(card)
      card.inert = true
      const remove = (): void => { active.delete(card); card.remove(); updateStack() }
      if (card.hidden) { remove(); return }
      const opacity = getComputedStyle(card).opacity
      card.style.animation = 'none'
      card.style.opacity = opacity
      card.style.height = `${card.getBoundingClientRect().height}px`
      // Establish the measured height before collapsing; siblings follow the
      // shrinking frame instead of jumping when the departing card is removed.
      void card.offsetHeight
      card.classList.add('leaving')
      card.style.removeProperty('opacity')
      const animations = card.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      if (animations.length) void Promise.allSettled(animations.map(animation => animation.finished)).then(remove)
      else remove()
    }
    // The frame owns dismissal: the toast's × emits au-close, and any renderer-drawn control marked
    // `data-role="dismiss"` (an action au-button) closes it on its au-activate — both bubble composed.
    card.addEventListener('au-close', () => dismiss())
    card.addEventListener('au-activate', (e) => {
      if ((e.target as HTMLElement | null)?.dataset.role === 'dismiss') dismiss()
    })
    // Pointer and keyboard interaction independently hold the notification open.
    // Leaving one must not restart dismissal while the other remains inside.
    let hovered = false
    function resumeTimer(): void {
      window.clearTimeout(timer)
      if (!dismissed && !card.hidden && !hovered && !card.matches(':focus-within')) {
        timer = window.setTimeout(dismiss, AUTO_DISMISS_MS)
      }
    }
    card.addEventListener('mouseenter', () => { hovered = true; window.clearTimeout(timer) })
    card.addEventListener('mouseleave', () => { hovered = false; resumeTimer() })
    card.addEventListener('focusin', () => window.clearTimeout(timer))
    card.addEventListener('focusout', () => queueMicrotask(resumeTimer))
    active.set(card, resumeTimer)
    updateStack()
  }

  return { show }
}

// Per-window singleton (each renderer window has its own module state), like getPreviewSurface.
//
// The layer is claimed ONCE and never released: this surface is always present for the window's
// lifetime, which is the guarantee the notification channel rests on — a notification is often an
// error and must reach the human with no composition mounted at all.
//
// NOT interactive at the layer level: the toast COLUMN must not swallow clicks on the app beneath
// it. Each toast re-enables `pointer-events` for itself (`.au-notif-toast`), which is the pattern
// the site expects and which this surface already used.
let singleton: NotificationSurface | null = null
export function getNotificationSurface(): NotificationSurface {
  return (singleton ??= createNotificationSurface(getOverlaySite().claim({ level: 'toast' }).el))
}
