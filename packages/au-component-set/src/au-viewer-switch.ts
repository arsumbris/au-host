// <au-viewer-switch> — the default set's Lit SHADOW implementation of the `au-viewer-switch` contract.

// The affordance on a file pane that offers to re-show the file in a DIFFERENT projection. A SPLIT button:
//   - the PRIMARY button (swap icon + `primaryLabel`) switches to the viewer that RENDERS the file — its
//     name when there is a single one, else "Open with" (the consumer then picks). Emits `au-activate`.
//   - the CHEVRON (shown only when `hasMore`) opens the SECONDARY group — projections that can be handed
//     the file but are not viewers (radial-tree, focal-tree). Emits `au-more`.
// The element names no projection and touches no host: the consuming projection labels it and runs the
// `viewerSwitchSets` / `runViewerSwitch` helper.


// LOOK: the shared document-action pill (`@arsumbris/style` document-controls.css), split into a primary +
// a chevron cell with a hairline between. TOKEN-ONLY. Absolute placement + reveal stay the projection's.

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
import { reducedControlMotion } from './control-motion'

export class AuViewerSwitchElement extends AuElement {
  static properties = {
    primaryLabel: { type: String, attribute: 'primary-label' },
    hasMore: { type: Boolean, attribute: 'has-more', reflect: true },
    disabled: { type: Boolean, reflect: true },
  }

  declare primaryLabel: string
  declare hasMore: boolean
  declare disabled: boolean

  constructor() {
    super()
    this.primaryLabel = 'Open with'
    this.hasMore = false
    this.disabled = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: inline-flex;
    }
    .group {
      display: inline-flex;
      align-items: stretch;
      border-radius: var(--au-radius-sm,5px);
      background: transparent;
      overflow: hidden;
    }
    button {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--au-space-1, 4px);
      min-block-size: var(--au-space-7);
      padding: 0 var(--au-space-2, 8px);
      border: 0;
      border-radius: var(--au-radius-sm);
      background: transparent;
      color: var(--au-ink-2, #b5b5b5);
      font: var(--au-t-xs,12px) / 1 var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      cursor: pointer;
      outline: 1px solid transparent;
      transition:
        color var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1)),
        background-color var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast, 160ms) var(--au-e-std, cubic-bezier(0.2, 0, 0, 1));
    }
    .primary {
      inline-size: calc(var(--au-space-7) * 3);
      min-inline-size: 0;
    }
    .primary:active:not(:disabled) {
      color: var(--au-ink-1);
      background: var(--au-chrome-hover);
    }
    .more {
      padding-inline: var(--au-space-1, 4px);
    }
    svg {
      inline-size: var(--au-t-base,14px);
      block-size: var(--au-t-base,14px);
      flex: none;
      display: block;
    }
    .chev {
      inline-size: var(--au-space-3, 12px);
      block-size: var(--au-space-3, 12px);
    }
    .label {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .label:empty {
      display: none;
    }
    button:hover:not(:disabled),
    :host([data-force-hover]:not([disabled])) button {
      color: var(--au-ink-1, #ededed);
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
    }
    button:focus-visible,
    :host([data-force-focus]) button {
      ${controlFocusStyle}
    }
    button:disabled,
    :host([data-force-disabled]) button {
      color: var(--au-ink-3, #8a8a8a);
      cursor: default;
    }
  `

  private onPrimary(e: MouseEvent): void {
    if (this.disabled) { e.stopImmediatePropagation(); return }
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  private onMore(e: MouseEvent): void {
    if (this.disabled) { e.stopImmediatePropagation(); return }
    this.dispatchEvent(new CustomEvent('au-more', { bubbles: true, composed: true }))
  }

  render() {
    const text = (this.primaryLabel ?? '').trim()
    return html`
      <div class="group" part="group">
        <button
          class="primary"
          part="primary"
          type="button"
          aria-label=${text || 'Open with a different viewer'}
          title=${text || 'Open with a different viewer'}
          ?disabled=${this.disabled}
          @click=${this.onPrimary}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
            <path d="M3 5.5h9m0 0-2.5-2.5M12 5.5l-2.5 2.5"></path>
            <path d="M13 10.5H4m0 0 2.5-2.5M4 10.5l2.5 2.5"></path>
          </svg>
          <span class="label">${text}</span>
        </button>
        ${this.hasMore
          ? html`<button
              class="more"
              part="more"
              type="button"
              aria-label="More ways to open this file"
              ?disabled=${this.disabled}
              @click=${this.onMore}
            >
              <svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
                <path d="m4 6 4 4 4-4"></path>
              </svg>
            </button>`
          : null}
      </div>
    `
  }
}
