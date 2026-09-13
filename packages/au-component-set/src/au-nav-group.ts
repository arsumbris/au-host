// <au-nav-group> — the default set's Lit SHADOW implementation of the `au-nav-group` contract.
//
// A titled cluster of nav rows: an eyebrow (composed from <au-section-header>) over a default slot of
// <au-tree-row> / <au-nav-item> children. Purely structural — it owns the vertical rhythm between the
// eyebrow and its items and the tight gap between rows. Collapse state is owned by the CALLER; when
// collapsed the items slot is simply not rendered. TOKEN-ONLY.
//
// Data-in: `label` (the eyebrow text) + `count` are attributes; `actions` is a slot forwarded to the
// header; `collapsible` / `open` / `sans` / `caps` set the header's variant. Emits `au-toggle`
// (composed + bubbling) when the header is activated — the caller flips `open`.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
export class AuNavGroupElement extends AuElement {
  static properties = {
    label: { type: String },
    count: { type: String },
    collapsible: { type: Boolean, reflect: true },
    open: { type: Boolean, reflect: true },
    sans: { type: Boolean, reflect: true },
    caps: { type: Boolean, reflect: true },
    chevronEnd: { type: Boolean, reflect: true, attribute: 'chevron-end' },
  }

  declare label?: string
  declare count?: string
  declare collapsible: boolean
  declare open: boolean
  declare sans: boolean
  declare caps: boolean
  declare chevronEnd: boolean

  constructor() {
    super()
    this.collapsible = false
    this.chevronEnd = false
    // Default CLOSED (see au-section-header): React omits `open={false}`, so a `true` default could
    // never be closed. A non-collapsible group always shows its items (`showItems` below), so this
    // default only governs a collapsible group with no explicit `open`.
    this.open = false
    this.sans = false
    this.caps = false
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      /* header -> first row: the header sits WITH its cluster rather than floating between two. */
      gap: var(--au-space-2, 8px);
      width: 100%;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: var(--au-space-0-5, 2px);
    }
  `

  private onToggle(e: Event): void {
    // Re-fire from the group so a consumer can listen on <au-nav-group> directly.
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('au-toggle', { bubbles: true, composed: true }))
  }

  render() {
    // Not collapsible → always show items; collapsible → show only when open.
    const showItems = !this.collapsible || this.open
    return html`
      <au-section-header
        part="header"
        exportparts="header, chevron, label, count, actions"
        ?collapsible=${this.collapsible}
        ?open=${this.open}
        ?sans=${this.sans}
        ?caps=${this.caps}
        ?chevron-end=${this.chevronEnd}
        count=${this.count ?? nothing}
        @au-toggle=${this.onToggle}
        >${this.label ?? nothing}<slot name="actions" slot="actions"></slot></au-section-header
      >
      ${showItems ? html`<div class="items" part="items"><slot></slot></div>` : nothing}
    `
  }
}
