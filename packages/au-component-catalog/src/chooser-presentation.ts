export { makeOverlayMovable } from './movable-overlay'
import { makeOverlayMovable } from './movable-overlay'
import type { ChooseRequest, ChooseOption } from '@arsumbris/au-host-sdk'

/** Host-only step navigation; option ids remain opaque and cannot collide with Back. */
export const CHOOSER_BACK = Symbol('chooser-back')
export type Choice = string | null | typeof CHOOSER_BACK
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
.au-chooser-list { min-block-size: 0; overflow: auto; display: flex; flex-direction: column; gap: var(--au-space-0-5); padding-inline-end: var(--au-space-2); max-block-size: 50vh; }
.au-chooser-section { padding: var(--au-space-2) var(--au-space-2) var(--au-space-1); font-size: var(--au-t-xs); line-height: var(--au-lh-xs); font-weight: var(--au-w-medium); color: var(--au-ink-3); }
.au-chooser-footer { display: flex; align-items: center; gap: var(--au-space-2); }
.au-chooser-help { flex: 1; min-inline-size: 0; margin: 0; color: var(--au-ink-3); font-size: var(--au-t-xs); line-height: var(--au-lh-xs); }
.au-chooser-backdrop au-pane-target::part(label), .au-chooser-backdrop au-pane-target::part(hint) { display: none; }
`

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
export function createChooserPresentation(root: HTMLElement, _invocationAnchor?: () => DOMRect | null) {
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
      backdrop.setAttribute('aria-label', req.title || 'Choose an option')
      const card = document.createElement('au-popover') as HTMLElement & { arrow: boolean }
      card.arrow = false
      card.className = 'au-chooser-card'
      const heading = document.createElement('div')
      heading.className = 'au-chooser-heading'
      const title = document.createElement('h2')
      title.className = 'au-chooser-title'
      title.textContent = req.title || 'Choose an option'
      heading.append(title)
      const movement = makeOverlayMovable(card, heading)
      const list = document.createElement('div')
      list.className = 'au-chooser-list'
      list.setAttribute('role', 'menu')
      list.setAttribute('aria-label', req.title || 'Choose an option')
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
      const targets: { option: ChooseOption; element: PaneTarget; index: number }[] = []
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
        row.shortcut = ''
        row.tabIndex = -1
        row.addEventListener('pointerenter', () => { highlighted = index; paint() })
        row.addEventListener('focus', () => { highlighted = index; paint() })
        row.addEventListener('au-activate', () => pick(index))
        rows.push(row)
        list.append(row)
        if (!option.anchor) return
        const pane = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(option.anchor)}"]`)
        const rect = pane?.getBoundingClientRect()
        if (!rect || rect.width <= 0 || rect.height <= 0) return // remains reachable in the list
        const target = document.createElement('au-pane-target') as PaneTarget
        target.hint = ''
        target.label = option.label
        target.setAttribute('aria-hidden', 'true') // equivalent accessible action lives in the list
        target.style.position = 'fixed'
        target.addEventListener('au-activate', () => pick(index))
        target.addEventListener('pointerenter', () => { highlighted = index; paint() })
        backdrop.insertBefore(target, card)
        targets.push({ option, element: target, index })
      })

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
          const pane = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(target.option.anchor!)}"]`)
          const rect = pane?.getBoundingClientRect()
          target.element.hidden = !rect || rect.width <= 0 || rect.height <= 0
          if (!rect) continue
          Object.assign(target.element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
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
      currentCancel = () => close(null)
      paint(); position(); focusRow()
      // Slotted rows become focusable after the registered popover renders its shadow slot.
      requestAnimationFrame(() => { if (!settled) { position(); focusRow() } })
    })
  }
  return { choose, dispose: () => currentCancel?.() }
}
