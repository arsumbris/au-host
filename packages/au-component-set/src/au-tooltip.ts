// au-tooltip renders the tooltip bubble. The caller owns trigger wiring, hover delay, positioning
// and overlay placement; this element supplies the token-styled surface only.

import { reducedControlMotion } from './control-motion'
import { LitElement, css, html } from 'lit'
import { claimHostOverlay, type OverlayLayer } from '@arsumbris/component-contract'

export type AuTooltipSide = 'top' | 'right' | 'bottom' | 'left'

export class AuTooltipElement extends LitElement {
  static properties = {
    side: { type: String, reflect: true },
    arrow: { type: Boolean, reflect: true },
  }
  declare side: AuTooltipSide
  declare arrow: boolean

  constructor() {
    super()
    this.side = 'top'
    this.arrow = true
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      position: relative;
      display: inline-flex;
      align-items: center;
      max-width: min(100%, calc(var(--au-space-1, 4px) * 72));
      box-sizing: border-box;
      padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
      color: var(--au-ink-1, #ededed);
      background: var(--au-elev-5-fill, #2a2a2e);
      border-radius: var(--au-radius-sm,5px);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14)),
        var(--au-sh-header,0 1px 0 rgba(245, 243, 238, 0.06), 0 8px 24px -16px rgba(0, 0, 0, 0.4));
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      font-variant-numeric: tabular-nums;
      white-space: normal;
      overflow-wrap: anywhere;
      animation: au-tooltip-in var(--au-m-fast,160ms) var(--au-e-soft,cubic-bezier(0.22, 1, 0.36, 1)) both;
    }
    /* Exit — a container flips [data-state='closed'] to play the out animation before releasing. */
    :host([data-state='closed']) {
      animation: au-tooltip-out var(--au-m-fast,160ms) var(--au-e-deep,cubic-bezier(0.16, 1, 0.3, 1)) both;
    }
    .label {
      min-width: 0;
      position: relative;
    }
    .arrow {
      position: absolute;
      width: var(--au-space-1, 4px);
      height: var(--au-space-1, 4px);
      background: var(--au-elev-5-fill, #2a2a2e);
      box-shadow: var(--au-elev-5-line,inset 0 0 0 1px rgba(245, 243, 238, 0.14));
      transform: rotate(45deg);
    }
    :host([side='top']) .arrow {
      bottom: calc(var(--au-space-0-5, 2px) * -1);
      left: 50%;
      margin-left: calc(var(--au-space-0-5, 2px) * -1);
    }
    :host([side='bottom']) .arrow {
      top: calc(var(--au-space-0-5, 2px) * -1);
      left: 50%;
      margin-left: calc(var(--au-space-0-5, 2px) * -1);
    }
    :host([side='left']) .arrow {
      right: calc(var(--au-space-0-5, 2px) * -1);
      top: 50%;
      margin-top: calc(var(--au-space-0-5, 2px) * -1);
    }
    :host([side='right']) .arrow {
      left: calc(var(--au-space-0-5, 2px) * -1);
      top: 50%;
      margin-top: calc(var(--au-space-0-5, 2px) * -1);
    }
    @keyframes au-tooltip-in {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @keyframes au-tooltip-out {
      from {
        opacity: 1;
        transform: none;
      }
      to {
        opacity: 0;
        transform: scale(0.96);
      }
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'tooltip')
  }

  render() {
    return html`${this.arrow ? html`<span class="arrow" part="arrow" aria-hidden="true"></span>` : ''}<span
        class="label"
        part="label"
        ><slot></slot
      ></span>`
  }
}

// THE HOST SEAM — float an `<au-tooltip>` as a transient tip anchored to an element, drawn into a layer
// claimed from the host overlay's `tooltip` band (the sanctioned channel, never a document.body portal).
// The bubble is the LOOK; this is the who/where. Returns null when no overlay host has published a claim
// (a standalone render) so the caller can degrade.

export interface TooltipHandle {
  /** Update the shown text (a live `title` change) and re-anchor. */
  update(text: string): void
  /** Play the exit animation, then release the claimed layer. Idempotent. */
  hide(): void
}

const GAP = 6

export function showTooltip(
  anchor: HTMLElement,
  text: string,
  opts?: { side?: AuTooltipSide },
): TooltipHandle | null {
  const layer: OverlayLayer | null = claimHostOverlay('tooltip')
  if (!layer) return null

  const tip = document.createElement('au-tooltip') as AuTooltipElement
  tip.textContent = text
  tip.style.position = 'fixed'
  tip.style.pointerEvents = 'none'
  layer.el.appendChild(tip)

  const position = (): void => {
    const r = anchor.getBoundingClientRect()
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    // Prefer ABOVE; flip below when it would clip the viewport top. `side` is the arrow's pointing edge:
    // side='top' → bubble above the trigger (arrow points down); side='bottom' → below (arrow up).
    let side: AuTooltipSide = opts?.side ?? 'top'
    let top: number
    if (side === 'bottom') {
      top = r.bottom + GAP
      if (top + th > window.innerHeight - 4) {
        top = r.top - GAP - th
        side = 'top'
      }
    } else {
      top = r.top - GAP - th
      if (top < 4) {
        top = r.bottom + GAP
        side = 'bottom'
      }
    }
    top = Math.max(4, top)
    let left = r.left + r.width / 2 - tw / 2
    left = Math.max(4, Math.min(left, window.innerWidth - tw - 4))
    tip.side = side
    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }

  // offsetWidth/Height read once the element upgrades + renders; a rAF lets Lit paint the shadow first.
  requestAnimationFrame(position)
  position()
  const onReflow = (): void => position()
  window.addEventListener('scroll', onReflow, true)
  window.addEventListener('resize', onReflow)

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    window.removeEventListener('scroll', onReflow, true)
    window.removeEventListener('resize', onReflow)
    tip.remove()
    layer.release()
  }

  return {
    update(next: string): void {
      tip.textContent = next
      position()
    },
    hide(): void {
      if (released) return
      tip.setAttribute('data-state', 'closed')
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        release()
      }
      tip.addEventListener('animationend', finish, { once: true })
      // Fallback if the animation never fires (reduced-motion collapse, detached, etc.).
      setTimeout(finish, 250)
    },
  }
}
