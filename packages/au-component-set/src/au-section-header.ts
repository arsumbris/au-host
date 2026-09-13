// <au-section-header> — the default set's Lit SHADOW implementation of the `au-section-header` contract.
//
// The quiet section label that titles a sidebar / panel group: mono, small, muted ink, with an optional
// right-aligned `count` and an optional `actions` slot. May be made `collapsible` (composes
// <au-chevron>, a real keyboard target — unlike a tree row, a section header IS the disclosure control
// and its chevron is correctly tabbable). SENTENCE CASE by default; `sans` steps the label up to the
// full sans reading face for a NAMED panel section; `caps` opts back into the mono uppercase eyebrow
// for a genuinely machine-ish label; `locked` reads a step quieter and suppresses collapse. TOKEN-ONLY.
//
// Data-in: `label` (NOT `title` — that shadows HTMLElement.title) is the default slot; `count` is an
// attribute; `actions` is a slot. Emits `au-toggle` (composed + bubbling) when a collapsible,
// non-locked header is activated.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
export class AuSectionHeaderElement extends AuElement {
  static properties = {
    count: { type: String },
    collapsible: { type: Boolean, reflect: true },
    open: { type: Boolean, reflect: true },
    locked: { type: Boolean, reflect: true },
    sans: { type: Boolean, reflect: true },
    caps: { type: Boolean, reflect: true },
    chevronEnd: { type: Boolean, reflect: true, attribute: 'chevron-end' },
    hasActions: { type: Boolean, reflect: true, attribute: 'has-actions' },
  }

  declare count?: string
  declare collapsible: boolean
  declare open: boolean
  declare locked: boolean
  declare sans: boolean
  declare caps: boolean
  declare chevronEnd: boolean
  declare hasActions: boolean

  constructor() {
    super()
    this.collapsible = false
    this.chevronEnd = false
    // Default CLOSED, not open: React omits an attribute for `open={false}`, so a `true` default would
    // be indistinguishable from "not set" and a collapsible header could never close. A non-collapsible
    // header ignores `open` anyway (nothing to disclose).
    this.open = false
    this.locked = false
    this.sans = false
    this.caps = false
    this.hasActions = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
    }
    .header {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      /* The same leading inset a row takes, so a section label and the rows it heads share one left
         edge and depth is the only thing that ever moves horizontally. */
      padding-inline: var(--au-space-1, 4px) var(--au-space-2, 8px);
      /* A bare section label is a LABEL, not a hit target, so it takes the label rank. The sans
         variant below names a real entity and steps back up to the navigation rank. */
      min-height: var(--au-row-h-label, 20px);
      /* The quiet sans eyebrow: a section label ranks BELOW the named things it labels, so it earns its
         rank by being smaller and dimmer rather than by shouting. Every floor here is the token's own
         registered initial value, so a bare render matches a themed one. */
      font-family: var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-2xs, 11px);
      line-height: var(--au-lh-2xs, 16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug, -0.02em);
      color: var(--au-ink-4, #8a857a);
    }
    :host([collapsible]:not([locked])) .header {
      cursor: pointer;
    }

    /* sans — the full sans label face for a NAMED panel section. Rests at ink-3, the same resting ink
       as a tree row, so a named section and the rows under it read as one family; emphasis is earned on
       hover/open rather than spent at rest. Floors are the tokens' registered initial values. */
    :host([sans]) .header {
      min-height: var(--au-row-h, 32px);
      font-family: var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      letter-spacing: var(--au-ls-snug, -0.02em);
      color: var(--au-ink-3, #a09c92);
    }
    :host([sans]:hover) .header,
    :host([sans][open]) .header {
      color: var(--au-ink-2, #d9d6cd);
    }
    /* caps — the mono uppercase eyebrow (shouted, opened-up tracking). */
    :host([caps]) .header {
      text-transform: uppercase;
      letter-spacing: var(--au-ls-label, 0.08em);
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    /* Trailing count — pinned to the quiet mono face regardless of the label variant. */
    .count {
      display: none;
      margin-left: auto;
      padding-left: var(--au-space-2, 8px);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs,12px);
      color: var(--au-ink-4, #959083);
      font-variant-numeric: tabular-nums;
      letter-spacing: var(--au-ls-mono,-0.005em);
      text-transform: none;
    }
    :host([has-count]) .count {
      display: inline;
    }

    /* Actions cluster (right-aligned when there is no count). */
    .actions {
      display: none;
    }
    :host([has-actions]) .actions {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      flex-shrink: 0;
    }
    :host([has-count]) .actions {
      margin-left: var(--au-space-2, 8px);
    }

    /* Collapsible headers tint the label on hover (the chevron carries the ring). */
    :host([collapsible]:not([locked]):hover) .label,
    :host([collapsible]:not([locked])[data-force-hover]) .label {
      color: var(--au-ink-3, #8a8a8a);
    }
    :host([sans][collapsible]:not([locked]):hover) .label,
    :host([sans][collapsible]:not([locked])[data-force-hover]) .label {
      color: var(--au-ink-1, #ededed);
    }

    /* Locked (structure-locked group) — the label reads one step quieter. */
    :host([locked]) .header {
      color: var(--au-ink-4, #959083);
      cursor: default;
    }

    /* chevron-end — the disclosure sits at the TRAILING edge, right-aligned. The label grows to fill so
       count / actions / chevron ride the right; the header gap spaces them. */
    :host([chevron-end]) .label {
      flex: 1 1 auto;
    }
    :host([chevron-end]) .count,
    :host([chevron-end]) .actions {
      margin-left: 0;
    }
    .chevron-trail {
      flex: none;
    }
  `

  // Reflect a `has-count` state so the CSS can hide the empty count span (an attribute, since `count`
  // is a value not a slot).
  updated(): void {
    const has = this.count != null && this.count !== ''
    if (has) this.setAttribute('has-count', '')
    else this.removeAttribute('has-count')
  }

  private toggle(): void {
    if (!this.collapsible || this.locked) return
    this.dispatchEvent(new CustomEvent('au-toggle', { bubbles: true, composed: true }))
  }

  private onActionsSlot(e: Event): void {
    const slot = e.target as HTMLSlotElement
    this.hasActions = slot.assignedNodes({ flatten: true }).some((n) => n.nodeType === Node.ELEMENT_NODE)
  }

  render() {
    const interactive = this.collapsible && !this.locked
    const chevron = this.collapsible
      ? html`<au-chevron
          part="chevron"
          class=${this.chevronEnd ? 'chevron-trail' : ''}
          ?open=${this.open}
          ?disabled=${this.locked}
          label=${this.open ? 'Collapse section' : 'Expand section'}
          @au-activate=${(e: Event) => {
            e.stopPropagation()
            this.toggle()
          }}
        ></au-chevron>`
      : nothing
    return html`
      <div
        class="header"
        part="header"
        data-collapsible=${interactive ? '' : nothing}
        @click=${interactive ? this.toggle : nothing}
      >
        ${this.chevronEnd ? nothing : chevron}
        <span class="label" part="label"><slot></slot></span>
        <span class="count" part="count">${this.count ?? nothing}</span>
        <div class="actions" part="actions"><slot name="actions" @slotchange=${this.onActionsSlot}></slot></div>
        ${this.chevronEnd ? chevron : nothing}
      </div>
    `
  }
}
