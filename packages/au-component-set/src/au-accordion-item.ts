// <au-accordion-item> — one collapsible disclosure: a header (icon · label/sublabel · meta slot · chevron)
// over a measured collapsible panel (the default slot). STANDALONE-CAPABLE: with no <au-accordion> parent
// it toggles its OWN `open` (a lone disclosure, the daemon-control pattern); inside a group the group drives
// `open` (single / multiple coordination). Either way it emits `au-toggle` (detail `{ value, open }`).
//
// The group propagates `variant` / `density` onto each item (so the item's own shadow styles itself — a
// descendant selector cannot cross the shadow boundary); a standalone item defaults to the `flush`
// disclosure look. The panel is a grid whose rows ease 0fr→1fr, so it animates to its true auto height with
// no magic constant. TOKEN-ONLY. Composes au-icon (leading glyph + chevron).

import { reducedControlMotion } from './control-motion'
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
export class AuAccordionItemElement extends AuElement {
  static properties = {
    value: { type: String },
    label: { type: String },
    icon: { type: String },
    sublabel: { type: String },
    disabled: { type: Boolean, reflect: true },
    selected: { type: Boolean, reflect: true },
    open: { type: Boolean, reflect: true },
    variant: { type: String, reflect: true },
    density: { type: String, reflect: true },
    _hasLead: { state: true },
    _hasActions: { state: true },
  }

  declare value: string
  declare label?: string
  declare icon?: string
  declare sublabel?: string
  declare disabled: boolean
  declare selected: boolean
  declare open: boolean
  declare variant: 'flush' | 'card' | 'inline'
  declare density: 'compact' | 'default' | 'relaxed'

  private _hasLead = false
  private _hasActions = false

  constructor() {
    super()
    this.value = ''
    this.disabled = false
    this.selected = false
    this.open = false
    this.variant = 'flush'
    this.density = 'default'
  }

  /** The group focuses an item's trigger during keyboard roving. */
  focusTrigger(): void {
    this.renderRoot.querySelector<HTMLButtonElement>('.trigger')?.focus()
  }

  // A leading control (a tri-state checkbox) sits BESIDE the toggle button so it owns its own click;
  // hover actions overlay just before the chevron. Both collapse when nothing is slotted.
  private onLeadSlot(e: Event): void {
    this._hasLead = (e.target as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
  }
  private onActionsSlot(e: Event): void {
    this._hasActions = (e.target as HTMLSlotElement).assignedNodes({ flatten: true }).length > 0
    this.toggleAttribute('data-has-actions', this._hasActions)
  }

  private onTrigger(): void {
    if (this.disabled) return
    // A group parent owns the open state (single / multiple); standalone, we toggle ourselves.
    const grouped = this.closest('au-accordion') != null
    if (!grouped) this.open = !this.open
    this.dispatchEvent(new CustomEvent('au-toggle', { detail: { value: this.value, open: this.open }, bubbles: true, composed: true }))
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      /* seeds — inherited from the group when nested; these are the standalone defaults. */
      --_row: var(--au-accordion-row, calc(var(--au-space-1, 4px) * 10));
      --_pad-x: var(--au-accordion-pad-x, var(--au-space-3, 12px));
      --_indent: var(--au-accordion-indent, var(--au-space-6, 24px));
      --_ink: var(--au-ink-3, #8a8a8a);
      --_glyph: var(--au-ink-4, #777);
      box-sizing: border-box;
      display: block;
      position: relative;
    }
    :host([density='compact']) { --_row: calc(var(--au-space-1, 4px) * 8); }
    :host([density='relaxed']) { --_row: calc(var(--au-space-1, 4px) * 12); }
    /* card / inline: the item is its own bordered block. */
    :host([variant='card']),
    :host([variant='inline']) {
      --_pad-x: var(--au-space-4, 16px);
      border-radius: var(--au-radius-panel,12px);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      transition: box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([variant='card']) { background: var(--au-elev-3-fill, #23262e); }
    :host([variant='inline']) { background: var(--au-elev-2-fill, #1c1f26); border-radius: var(--au-radius-row, 8px); }
    :host([variant='card']:hover),
    :host([variant='card'][open]),
    :host([variant='inline']:hover),
    :host([variant='inline'][open]) {
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
    }
    :host([disabled]) { opacity: var(--au-opacity-disabled, 0.5); }

    .header {
      position: relative;
      display: flex;
      align-items: stretch;
      width: 100%;
    }
    /* An INDEPENDENT leading control (a tri-state checkbox) — a sibling of the toggle button, so it owns
     * its own click / Space. */
    .lead {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      padding-left: var(--_pad-x);
    }
    .lead[hidden], .actions[hidden] { display: none; }
    .header[data-has-lead] .trigger { padding-left: var(--au-space-2, 8px); }
    /* Hover-revealed header actions — overlaid just before the chevron, OUTSIDE the button so each stays
     * independently clickable. Meta and actions swap in place so the chevron never shifts. */
    .actions {
      position: absolute;
      top: 0;
      bottom: 0;
      right: calc(var(--_pad-x) + var(--au-space-5, 20px) + var(--au-space-2, 8px));
      display: inline-flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .header:hover .actions,
    .header:focus-within .actions {
      opacity: 1;
      pointer-events: auto;
    }
    :host([data-has-actions]) .header:hover .meta,
    :host([data-has-actions]) .header:focus-within .meta {
      opacity: 0;
    }
    .trigger {
      box-sizing: border-box;
      appearance: none;
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      min-width: 0;
      min-height: var(--_row);
      padding: 0 var(--_pad-x);
      margin: 0;
      border: 0;
      border-radius: var(--au-radius-chip,6px);
      background: transparent;
      color: var(--_ink);
      font: inherit;
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      text-align: left;
      cursor: pointer;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .trigger[data-has-sublabel] { padding-block: var(--au-space-2, 8px); }
    :host([variant='flush']) .trigger { border-radius: 0; }
    .trigger:hover,
    :host([open]) .trigger,
    :host([selected]) .trigger {
      --_ink: var(--au-ink-1, #ededed);
    }
    .trigger:hover { --_glyph: var(--au-ink-3, #8a8a8a); }
    :host([variant='flush']) .trigger:hover { background: var(--au-elev-3-fill, #23262e); }
    :host([selected]) .trigger { background: var(--au-elev-3-fill, #23262e); }
    .trigger:focus-visible,
    :host([data-force-focus]) .trigger {
      ${controlFocusStyle}
      z-index: var(--au-z-raised,10);
    }
    :host([disabled]) .trigger { --_ink: var(--au-ink-5, #555); --_glyph: var(--au-ink-5, #555); cursor: not-allowed; }
    .icon { display: inline-flex; flex: 0 0 auto; align-items: center; color: var(--_glyph); }
    .label { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1 1 auto; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sublabel {
      margin-top: var(--au-space-0-5, 2px);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-xs,16px);
      font-weight: var(--au-w-body, 400);
      color: var(--au-ink-4, #777);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--au-space-2, 8px);
      color: var(--au-ink-4, #777);
      font-variant-numeric: tabular-nums;
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .chevron {
      display: inline-grid;
      place-items: center;
      flex: 0 0 auto;
      width: var(--au-space-5, 20px);
      height: var(--au-space-5, 20px);
      color: var(--_glyph);
    }
    .chevron au-icon {
      transition: transform var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1));
    }
    /* flush = disclosure (right→down); card/inline = caret (down→up). Base glyph points down. */
    :host([variant='flush']) .chevron au-icon { transform: rotate(-90deg); }
    :host([variant='flush'][open]) .chevron au-icon { transform: rotate(0deg); }
    :host([variant='card']) .chevron au-icon,
    :host([variant='inline']) .chevron au-icon { transform: rotate(0deg); }
    :host([variant='card'][open]) .chevron au-icon,
    :host([variant='inline'][open]) .chevron au-icon { transform: rotate(180deg); }

    .panel {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows var(--au-m-base,220ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([open]) .panel { grid-template-rows: 1fr; }
    .panel-inner { overflow: hidden; min-height: 0; }
    .panel-content {
      box-sizing: border-box;
      padding: var(--au-space-2, 8px) var(--_pad-x) var(--au-space-4, 16px);
      color: var(--au-ink-2, #c8c8c8);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-base,20px);
      opacity: 0;
      transform: translateY(var(--au-space-1, 4px));
      transition:
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    :host([variant='flush']) .panel-content {
      padding-left: calc(var(--_pad-x) + var(--_indent));
      padding-bottom: var(--au-space-3, 12px);
    }
    :host([open]) .panel-content { opacity: 1; transform: none; }
    /* the open hairline between header and panel (card / inline). */
    :host([variant='card'][open]) .panel-inner,
    :host([variant='inline'][open]) .panel-inner {
      box-shadow: inset 0 1px 0 var(--au-line-1, rgba(255, 255, 255, 0.08));
    }
  `

  render() {
    const hasSub = this.sublabel != null && this.sublabel !== ''
    return html`
      <div class="header" ?data-has-lead=${this._hasLead}>
        <span class="lead" part="lead" ?hidden=${!this._hasLead}><slot name="leading" @slotchange=${this.onLeadSlot}></slot></span>
        <button
          class="trigger"
          ?data-has-sublabel=${hasSub}
          part="trigger"
          type="button"
          aria-expanded=${this.open ? 'true' : 'false'}
          ?disabled=${this.disabled}
          @click=${this.onTrigger}
        >
          ${this.icon ? html`<span class="icon" part="icon" aria-hidden="true"><au-icon name=${this.icon} size="sm"></au-icon></span>` : nothing}
          <span class="label">
            <span class="title" part="title">${this.label ?? ''}</span>
            ${hasSub ? html`<span class="sublabel" part="sublabel">${this.sublabel}</span>` : nothing}
          </span>
          <span class="meta" part="meta"><slot name="meta"></slot></span>
          <span class="chevron" part="chevron" aria-hidden="true"><au-icon name="chevron-down" size="xs"></au-icon></span>
        </button>
        <span class="actions" part="actions" ?hidden=${!this._hasActions}><slot name="actions" @slotchange=${this.onActionsSlot}></slot></span>
      </div>
      <div class="panel" part="panel" role="region">
        <div class="panel-inner">
          <div class="panel-content" part="panel-content"><slot></slot></div>
        </div>
      </div>
    `
  }
}
