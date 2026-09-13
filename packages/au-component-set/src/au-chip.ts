// <au-chip> — a leaf: a labelled pill with an optional remove affordance emitting a composed au-remove.

import { css, html } from 'lit'
import { AuElement } from './au-element'

export class AuChipElement extends AuElement {
  static properties = {
    label: { type: String },
    variant: { type: String, reflect: true },
    removable: { type: Boolean },
  }
  declare label?: string
  declare variant?: 'neutral' | 'accent' | 'danger'
  declare removable: boolean

  constructor() {
    super()
    this.removable = false
  }

  static styles = css`
    :host {
      display: inline-block;
      max-width: 100%;
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      box-sizing: border-box;
      max-width: 100%;
      align-items: center;
      gap: var(--au-space-1, 4px);
      padding: var(--au-space-0-5, 2px) var(--au-space-2, 8px);
      border-radius: var(--au-radius-chip,6px);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-sm,16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      white-space: normal;
      overflow-wrap: anywhere;
      color: var(--au-ink-2, #c8c8c8);
      background: var(--au-color-surface-2, #2a2a2a);
    }
    :host([variant='accent']) .chip {
      color: var(--au-accent-signal, var(--au-color-accent, #9db4ff));
      background: var(--au-accent-soft, rgba(140, 170, 255, 0.12));
    }
    :host([variant='danger']) .chip {
      color: var(--au-color-danger, #e5484d);
      background: color-mix(in oklab, var(--au-color-danger, #e5484d) 14%, transparent);
    }
    [part='label'] { min-width: 0; }
    au-close-button { flex-shrink: 0; }

  `

  private onRemove(e: Event): void {
    e.stopPropagation()
    this.dispatchEvent(new CustomEvent('au-remove', { bubbles: true, composed: true }))
  }

  render() {
    return html`
      <span class="chip" part="chip">
        <span part="label">${this.label ?? ''}</span>
        ${this.removable
          ? html`<au-close-button
              part="remove"
              exportparts="button:remove-button"
              label=${this.label?.trim() ? `Remove ${this.label.trim()}` : 'Remove chip'}
              @au-activate=${this.onRemove}
              @click=${(event: Event) => event.stopPropagation()}
            ></au-close-button>`
          : ''}
      </span>
    `
  }
}
