// Compact non-interactive count, label, or semantic status dot.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

export class AuBadgeElement extends AuElement {
  static properties = {
    variant: { type: String, reflect: true },
    tone: { type: String, reflect: true },
  }

  declare variant?: 'label' | 'count' | 'dot'
  declare tone?: 'ink' | 'ok' | 'warn' | 'danger'

  static styles = css`
    :host {
      display: inline-flex;
      max-inline-size: 100%;
      min-inline-size: 0;
      vertical-align: middle;
    }
    :host([hidden]) { display: none; }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--au-space-1, 4px);
      min-width: var(--au-space-4, 16px);
      min-height: calc(var(--au-space-4, 16px) + var(--au-space-0-5, 2px));
      max-inline-size: 100%;
      padding: var(--au-space-0-5, 2px) calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      font-family: var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-2xs,11px);
      /* Counts stay vertically centered while enlarged text can grow the container. */
      line-height: max(1em, var(--au-lh-2xs));
      font-weight: var(--au-w-medium, 500);
      font-variant-numeric: tabular-nums;
      font-feature-settings: 'tnum';
      color: var(--au-ink-1, #ededed);
      background: var(--au-color-surface-2, #21242b);
      border-radius: var(--au-radius-sm, 5px);
      box-sizing: border-box;
      overflow-wrap: anywhere;
    }
    :host([variant='count']) .badge {
      min-width: calc(max(1em, var(--au-lh-2xs)) + var(--au-space-0-5) * 2);
      border-radius: var(--au-radius-pill, 99px);
      white-space: nowrap;
    }
    /* dot — a bare status marker, no content. */
    :host([variant='dot']) .badge {
      min-width: auto;
      min-height: 0;
      width: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      height: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
      padding: 0;
    }
    :host([tone='ok']) { --badge-tone: var(--au-color-ok, #76cd98); }
    :host([tone='warn']) { --badge-tone: var(--au-color-warn, #e6b55d); }
    :host([tone='danger']) { --badge-tone: var(--au-color-danger, #fb817c); }
    :host([tone='ok']) .badge,
    :host([tone='warn']) .badge,
    :host([tone='danger']) .badge {
      color: color-mix(in srgb, var(--badge-tone) 55%, var(--au-ink-1));
      background: color-mix(in srgb, var(--badge-tone) 12%, var(--au-color-surface-2));
    }
    :host([variant='dot']) .badge {
      border-radius: var(--au-radius-pill, 99px);
      background: var(--badge-tone, var(--au-ink-3));
    }
  `

  render() {
    return html`<span class="badge" part="badge"
      >${this.variant === 'dot' ? nothing : html`<slot></slot>`}</span
    >`
  }
}
