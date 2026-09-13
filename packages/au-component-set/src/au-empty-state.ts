// au-empty-state shows an optional icon, label, hint and action. label and hint are string props;
// icon and action are slots. The label prop avoids shadowing HTMLElement.title.
// Slotted actions remain in the caller's light DOM and retain their own styles.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuEmptyStateElement extends AuElement {
  static properties = {
    label: { type: String },
    hint: { type: String },
    _hasIcon: { state: true },
  }
  declare label?: string
  declare hint?: string
  declare _hasIcon: boolean

  constructor() {
    super()
    this._hasIcon = false
  }

  static styles = css`
    :host {
      box-sizing: border-box;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--au-space-2, 8px);
      padding: var(--au-space-7,32px) var(--au-space-5,20px);
      color: var(--au-ink-3, #9a9a9a);
    }
    .icon {
      display: grid;
      place-items: center;
      margin-bottom: var(--au-space-1, 4px);
      color: var(--au-ink-4, #777);
    }
    .title, .hint { margin: 0; overflow-wrap: anywhere; }
    .title {
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-lead,18px);
      line-height: var(--au-lh-lead,24px);
      font-weight: var(--au-w-strong,590);
      letter-spacing: var(--au-ls-snug,-0.02em);
      color: var(--au-ink-1, #e8e8e8);
    }
    .hint {
      max-width: var(--au-side-w,232px);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-body,24px);
      color: var(--au-ink-3, #9a9a9a);
    }
    [hidden] {
      display: none !important;
    }
  `

  private onIconSlot = (e: Event): void => {
    this._hasIcon = (e.target as HTMLSlotElement).assignedNodes().length > 0
  }

  render() {
    // The action `<slot>` is rendered DIRECTLY (its default `display:contents` means the slotted button
    // IS the flex item, exactly like the React kit's `{action}` — no wrapper span to add a phantom gap).
    // Only the icon keeps a wrapper (it carries the margin-bottom + centering), hidden when empty.
    return html`
      <span class="icon" part="icon" aria-hidden="true" ?hidden=${!this._hasIcon}>
        <slot name="icon" @slotchange=${this.onIconSlot}></slot>
      </span>
      <p class="title" part="title">${this.label ?? ''}</p>
      ${this.hint ? html`<p class="hint" part="hint">${this.hint}</p>` : ''}
      <slot name="action"></slot>
    `
  }
}
