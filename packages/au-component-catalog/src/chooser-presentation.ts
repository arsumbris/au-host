export { makeOverlayMovable } from './movable-overlay'
import { makeOverlayMovable } from './movable-overlay'
import type { ChooseRequest, ChooseOption } from '@arsumbris/au-host-sdk'

/** Host-only step navigation; option ids remain opaque and cannot collide with Back. */
export const CHOOSER_BACK = Symbol('chooser-back')
// A PROGRAMMATIC dismissal — a re-entrant open (a second chooser supersedes this one) or dispose — distinct
// from a user cancel (null via Esc / backdrop / the Cancel button), so the trace can tell them apart.
export const CHOOSER_SUPERSEDED = Symbol('chooser-superseded')
export type Choice = string | null | typeof CHOOSER_BACK | typeof CHOOSER_SUPERSEDED
export type ChooserStep = ChooseRequest & { back?: boolean }
type MenuRow = HTMLElement & { label: string; description: string; shortcut: string; active: boolean }
type PaneTarget = HTMLElement & { label: string; hint: string; active: boolean }

// The registered popover owns material, type, radius, spacing and reduced-motion behavior.
// These rules only arrange its contents and position the host-owned capture layer.
export const chooserStyle = `
.au-chooser-backdrop { position: fixed; inset: 0; pointer-events: auto; -webkit-app-region: no-drag; }
.au-chooser-card { position: fixed; inline-size: min(24rem, calc(100vw - 2 * var(--au-space-3))); max-block-size: calc(100vh - 2 * var(--au-space-3)); }
.au-chooser-card::part(body) { min-block-size: 0; }
.au-chooser-heading { display: flex; align-items: start; gap: var(--au-space-2); }
.au-chooser-title { flex: 1; min-inline-size: 0; margin: 0; font-size: var(--au-t-base); line-height: var(--au-lh-base); font-weight: var(--au-w-strong); color: var(--au-ink-1); overflow-wrap: anywhere; }
/* inline code in the title (a backtick-delimited segment), matching aup-reader's .au-md__code look. */
.au-chooser-code { font-family: var(--au-font-mono); font-size: 0.9em; font-weight: var(--au-w-medium); color: var(--au-ink-2); background: color-mix(in oklab, var(--au-ink-1) 7%, transparent); padding: 0.1em 0.36em; border-radius: var(--au-radius-sm, 5px); }
.au-chooser-list { min-block-size: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--au-space-0-5); padding-inline-end: var(--au-space-2); max-block-size: 50vh; }
.au-chooser-section { padding: var(--au-space-2) var(--au-space-2) var(--au-space-1); font-size: var(--au-t-xs); line-height: var(--au-lh-xs); font-weight: var(--au-w-medium); color: var(--au-ink-3); }
.au-chooser-footer { display: flex; align-items: center; gap: var(--au-space-2); }
.au-chooser-help { flex: 1; min-inline-size: 0; margin: 0; color: var(--au-ink-3); font-size: var(--au-t-xs); line-height: var(--au-lh-xs); }
.au-chooser-backdrop au-pane-target::part(label) { display: none; }
`

// Vimium letter-hints: each option gets a single-key label, in option (proximity/recency) order, shown on
// its list row (as the shortcut) AND on its spatial target (the au-kbd keycap). Typing the key picks it.
const HINT_KEYS = 'asdfghjklqwertyuiopzxcvbnm'

const hintFor = (index: number): string => HINT_KEYS[index] ?? ''

/** Render a title with markdown-style inline code: a `backtick`-delimited segment becomes a <code> chip.
 *  Text-node based (no innerHTML), so a caller's title is never interpreted as HTML. */
function renderTitle(host: HTMLElement, text: string): void {
  host.replaceChildren()
  text.split('`').forEach((part, i) => {
    if (part === '') return
    if (i % 2 === 1) {
      const code = document.createElement('code')
      code.className = 'au-chooser-code'
      code.textContent = part
      host.append(code)
    } else host.append(document.createTextNode(part))
  })
}

function deepActive(): HTMLElement | null {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  return el instanceof HTMLElement ? el : null
}

function composedContains(parent: HTMLElement, child: Element | null): boolean {
  for (let el = child; el; ) {
    if (parent.contains(el)) return true
    const root = el.getRootNode()
    el = root instanceof ShadowRoot ? root.host : null
  }
  return false
}

/** Same live presentation in the native host and catalogue. Caller owns every action. */
/** `resolveBounds` maps an option's `anchor` (a `data-pane-id`) to the on-screen rect the spatial target
 *  is drawn over. The HOST supplies it (it owns the composition DOM and how a container's several
 *  portaled regions add up to one extent), so this presentation never reads a `data-*` convention itself;
 *  absent → every option falls to a list row. Recomputed each layout, so a resolver that reads live rects
 *  tracks resize. */
export function createChooserPresentation(
  root: HTMLElement,
  _invocationAnchor?: () => DOMRect | null,
  resolveBounds?: (anchor: string) => DOMRect | null,
) {
  let origin: HTMLElement | null = null
  let currentCancel: (() => void) | undefined

  function choose(req: ChooserStep): Promise<Choice> {
    currentCancel?.()
    const active = deepActive()
    if (active && !composedContains(root, active)) {
      origin = active
    }
    return new Promise(resolve => {
      const backdrop = document.createElement('div')
      backdrop.className = 'au-chooser-backdrop'
      backdrop.setAttribute('role', 'dialog')
      backdrop.setAttribute('aria-modal', 'true')
      const titleText = req.title || 'Choose an option'
      const titlePlain = titleText.replace(/`/g, '') // backticks are inline-code delimiters, not spoken text
      backdrop.setAttribute('aria-label', titlePlain)
      const card = document.createElement('au-popover') as HTMLElement & { arrow: boolean }
      card.arrow = false
      card.className = 'au-chooser-card'
      const heading = document.createElement('div')
      heading.className = 'au-chooser-heading'
      const title = document.createElement('h2')
      title.className = 'au-chooser-title'
      renderTitle(title, titleText)
      heading.append(title)
      const movement = makeOverlayMovable(card, heading)
      const list = document.createElement('div')
      list.className = 'au-chooser-list'
      list.setAttribute('role', 'menu')
      list.setAttribute('aria-label', titlePlain)
      const footer = document.createElement('div')
      footer.className = 'au-chooser-footer'
      const help = document.createElement('p')
      help.className = 'au-chooser-help'
      const spatial = req.options.some(o => o.anchor !== undefined)
      help.textContent = req.options.length ? '↑ ↓ move · Enter selects · Esc cancels' : 'No available options.'
      const buttons: HTMLElement[] = []
      function action(label: string, outcome: Choice): HTMLElement {
        const button = document.createElement('au-button')
        button.setAttribute('variant', 'ghost')
        button.setAttribute('size', 'sm')
        button.textContent = label
        button.addEventListener('au-activate', () => close(outcome))
        buttons.push(button)
        return button
      }
      if (req.back) footer.append(action('Back', CHOOSER_BACK))
      footer.append(help, action('Cancel', null))
      card.append(heading, list, footer)
      backdrop.append(card)
      root.append(backdrop)

      const rows: MenuRow[] = []
      const targets: { option: ChooseOption; element: PaneTarget; index: number; area: number }[] = []
      let highlighted = 0
      let settled = false
      const focusRow = () => (rows[highlighted] ?? buttons[0])?.focus({ preventScroll: true })
      function paint() {
        rows.forEach((row, index) => { row.active = index === highlighted; row.tabIndex = index === highlighted ? 0 : -1 })
        targets.forEach(target => { target.element.active = target.index === highlighted })
      }
      const pick = (index: number) => close(req.options[index]?.id ?? null)
      if (req.options.length === 0) help.textContent = 'No available options.'
      let section: string | undefined
      req.options.forEach((option, index) => {
        if (option.section && option.section !== section) {
          section = option.section
          const label = document.createElement('div')
          label.className = 'au-chooser-section'
          label.textContent = section
          list.append(label)
        }
        const row = document.createElement('au-menu-item') as MenuRow
        row.label = option.label
        row.description = option.hint || ''
        row.shortcut = hintFor(index)
        row.tabIndex = -1
        row.addEventListener('pointerenter', () => { highlighted = index; paint() })
        row.addEventListener('focus', () => { highlighted = index; paint() })
        row.addEventListener('au-activate', () => pick(index))
        rows.push(row)
        list.append(row)
        if (!option.anchor || !resolveBounds) return
        const rect = resolveBounds(option.anchor)
        if (!rect || rect.width <= 0 || rect.height <= 0) return // no on-screen slot — remains reachable in the list
        const target = document.createElement('au-pane-target') as PaneTarget
        target.hint = hintFor(index)
        target.label = option.label
        target.setAttribute('aria-hidden', 'true') // equivalent accessible action lives in the list
        target.style.position = 'fixed'
        target.addEventListener('au-activate', () => pick(index))
        target.addEventListener('pointerenter', () => { highlighted = index; paint() })
        backdrop.insertBefore(target, card)
        targets.push({ option, element: target, index, area: rect.width * rect.height })
      })
      // Nested targets: reorder biggest→smallest in the DOM so the SMALLER rect sits on top (a later sibling
      // wins within the backdrop's stacking context) — both stay hoverable + clickable, each keeps its letter.
      // No z-index: the card is inserted LAST, so it stays ABOVE every target and the dialog reads over the overlay.
      for (const t of [...targets].sort((a, b) => b.area - a.area)) backdrop.insertBefore(t.element, card)

      // Pre-highlight the head (index 0, the MRU default the caller ordered first) when it is ON-SCREEN;
      // otherwise the top on-screen candidate, so a blind Enter never fires into an off-screen or
      // cross-window target. With no on-screen target at all (an all-remote / all-command set) the head
      // row stays the default — the picker is still visible, so the pick is not blind.
      if (targets.length && !targets.some(t => t.index === highlighted)) {
        highlighted = Math.min(...targets.map(t => t.index))
      }

      function position() {
        const spacing = parseFloat(getComputedStyle(card).getPropertyValue('--au-space-3')) || 12
        // Position against layout dimensions, not the popover's animated scale.
        const bounds = { width: card.offsetWidth, height: card.offsetHeight }
        // Center the chooser in the window; pane anchors remain spatial selection targets.
        const left = (innerWidth - bounds.width) / 2
        const top = (innerHeight - bounds.height) / 2
        if (!movement.moved) card.style.left = `${Math.max(spacing, Math.min(left, innerWidth - bounds.width - spacing))}px`
        if (!movement.moved) card.style.top = `${Math.max(spacing, Math.min(top, innerHeight - bounds.height - spacing))}px`
        movement.clamp()
        for (const target of targets) {
          // The host resolves the FULL slot extent, so a container draws over its whole region (tab bar +
          // content), not just the content box it shares with the pane. Recomputed each layout → resize-safe.
          const box = target.option.anchor && resolveBounds ? resolveBounds(target.option.anchor) : null
          target.element.hidden = !box || box.width <= 0 || box.height <= 0
          if (!box) continue
          Object.assign(target.element.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` })
        }
      }
      function close(result: Choice) {
        if (settled) return
        settled = true
        movement.dispose()
        observer.disconnect()
        document.removeEventListener('keydown', onKey, true)
        document.removeEventListener('focusin', onFocus, true)
        window.removeEventListener('resize', position)
        window.removeEventListener('scroll', position, true)
        backdrop.remove()
        currentCancel = undefined
        origin?.isConnected && origin.focus({ preventScroll: true })
        resolve(result)
      }
      function onFocus(event: FocusEvent) {
        if (!composedContains(backdrop, event.composedPath()[0] as Element)) focusRow()
      }
      function onKey(event: KeyboardEvent) {
        const key = event.key
        const within = composedContains(list, deepActive())
        if (key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(null); return }
        if (key === 'Tab') {
          event.preventDefault(); event.stopImmediatePropagation()
          const stops = [rows[highlighted], ...buttons].filter(Boolean)
          const index = stops.findIndex(el => composedContains(el, deepActive()))
          stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus()
          return
        }
        // Vimium letter-hint: a bare single-character key naming an option's hint picks it directly (the
        // modal captures all keys while open; a modified chord or a multi-key name like Arrow* is left alone).
        if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const i = HINT_KEYS.indexOf(key.toLowerCase())
          if (i >= 0 && i < req.options.length) { event.preventDefault(); event.stopImmediatePropagation(); pick(i); return }
        }
        if (rows.length > 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
          event.preventDefault(); event.stopImmediatePropagation()
          if (key === 'Home') highlighted = 0
          else if (key === 'End') highlighted = rows.length - 1
          else highlighted = (highlighted + (key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
          paint(); focusRow(); rows[highlighted]?.scrollIntoView({ block: 'nearest' }); return
        }
        if (spatial && (key === 'ArrowLeft' || key === 'ArrowRight')) {
          event.preventDefault(); event.stopImmediatePropagation()
          const from = targets.find(target => target.index === highlighted)?.element.getBoundingClientRect()
          if (!from) return
          const direction = key === 'ArrowRight' ? 1 : -1
          let nearest: typeof targets[number] | undefined
          let cost = Infinity
          movement.clamp()
        for (const target of targets) {
            const rect = target.element.getBoundingClientRect()
            const along = ((rect.left + rect.width / 2) - (from.left + from.width / 2)) * direction
            const distance = along + Math.abs((rect.top + rect.height / 2) - (from.top + from.height / 2)) * 2
            if (along > 0 && distance < cost) { cost = distance; nearest = target }
          }
          if (nearest) { highlighted = nearest.index; paint(); focusRow() }
          return
        }
        if (within && (key === 'Enter' || key === ' ')) {
          event.preventDefault(); event.stopImmediatePropagation(); pick(highlighted); return
        }

      }
      backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) close(null) })
      const observer = new ResizeObserver(position)
      observer.observe(card)
      targets.forEach(target => {
        const pane = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(target.option.anchor!)}"]`)
        if (pane) observer.observe(pane)
      })
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('focusin', onFocus, true)
      window.addEventListener('resize', position)
      window.addEventListener('scroll', position, true)
      currentCancel = () => close(CHOOSER_SUPERSEDED) // a re-entrant open or dispose, NOT a user cancel
      paint(); position(); focusRow()
      // Slotted rows become focusable after the registered popover renders its shadow slot.
      requestAnimationFrame(() => { if (!settled) { position(); focusRow() } })
    })
  }
  return { choose, dispose: () => currentCancel?.() }
}
