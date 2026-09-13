// Semantic metadata pairs with inline or stacked layout and optional status indicators.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

export interface AuDetailItem {
  term: string
  value?: string
  mono?: boolean
  tone?: 'ok' | 'warn' | 'danger'
  // How the value reads: `text` (default) tints the value text in the tone; `dot` composes an
  // au-status-dot before neutral text; `badge` renders the value as a filled au-badge pill.
  valueKind?: 'text' | 'dot' | 'badge'
}

export class AuDetailListElement extends AuElement {
  static properties = {
    // A JS property (the React wrapper / a projection sets `.items`), with a JSON-attribute converter
    // so a static `items='[…]'` (the catalog preview, plain HTML) renders too.
    items: {
      converter: { fromAttribute: (v: string | null) => (v ? (JSON.parse(v) as AuDetailItem[]) : []) },
    },
    layout: { type: String, reflect: true },
    separators: { type: Boolean, reflect: true },
  }

  declare items: AuDetailItem[]
  declare layout: 'inline' | 'stacked'
  declare separators: boolean

  constructor() {
    super()
    this.items = []
    this.layout = 'inline'
    this.separators = false
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      container: au-detail-list / inline-size;
      min-width: 0;
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-base,20px);
      text-align: left;
    }
    dl {
      display: flex;
      flex-direction: column;
      min-width: 0;
      margin: 0;
    }
    .row {
      display: flex;
      min-width: 0;
      box-sizing: border-box;
    }
    .row:first-child {
      padding-block-start: 0;
    }
    .row:last-child {
      padding-block-end: 0;
    }
    /* term (the key) — the muted half of the two-step. colour, not weight, makes it recede. */
    dt {
      min-width: 0;
      margin: 0;
      color: var(--au-ink-3, #9a9a9a);
      font-weight: var(--au-w-medium, 500);
      overflow-wrap: anywhere;
    }
    /* value (the datum) — bright, the loud half. */
    dd {
      min-width: 0;
      margin: 0;
      color: var(--au-ink-2, #c8c8c8);
      font-weight: var(--au-w-body, 400);
      overflow-wrap: anywhere;
    }
    dd[data-mono] {
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
    }
    dd[data-empty] {
      color: var(--au-ink-4, #959083);
    }
    dd[data-tone='ok'] {
      color: var(--au-color-ok, #76cd98);
    }
    dd[data-tone='warn'] {
      color: var(--au-color-warn, #e6b55d);
    }
    dd[data-tone='danger'] {
      color: var(--au-color-danger, #fb817c);
    }
    /* composed value — a status dot before neutral label text. */
    .dotval {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--au-space-1, 4px) + var(--au-space-0-5, 2px));
    }
    /* ── inline dialect — term left, value right; both edges scan clean. ── */
    :host([layout='inline']) .row {
      display: grid;
      grid-template-columns: minmax(0, 35%) minmax(0, 1fr);
      align-items: baseline;
      gap: var(--au-space-4, 16px);
      padding-block: var(--au-space-1, 4px);
    }
    :host([layout='inline']) dt {
      flex: 0 1 auto;
    }
    :host([layout='inline']) dd {
      flex: 0 1 auto;
      text-align: right;
    }
    /* ── stacked dialect — micro-sized term ABOVE the value; airier pairs. ── */
    :host([layout='stacked']) .row {
      flex-direction: column;
      align-items: stretch;
      gap: var(--au-space-1, 4px);
      padding-block: var(--au-space-2, 8px);
    }
    :host([layout='stacked']) dt {
      font-size: var(--au-t-2xs, 11px);
      line-height: var(--au-lh-2xs,16px);
    }
    @container au-detail-list (max-width: 18rem) {
      :host([layout='inline']) .row {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--au-space-0-5, 2px);
        padding-block: var(--au-space-2, 8px);
      }
      :host([layout='inline']) dd { text-align: left; }
    }
    /* ── separators — an opt-in hairline between adjacent pairs (dividers, never boxes). ── */
    :host([separators]) .row + .row {
      border-top: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.09));
    }
  `

  render() {
    return html`
      <dl part="list">
        ${(this.items ?? []).map((it) => {
          const empty = it.value == null || it.value === ''
          const kind = it.valueKind ?? 'text'
          // dot / badge compose a status atom into the value; the dd text stays neutral (the atom
          // carries the tone). text tints the value text via data-tone.
          const body =
            empty
              ? '—'
              : kind === 'dot'
                ? html`<span class="dotval"
                    ><au-status-dot tone=${it.tone ?? 'ok'} size="sm"></au-status-dot>${it.value}</span
                  >`
                : kind === 'badge'
                  ? html`<au-badge tone=${it.tone ?? 'ok'}>${it.value}</au-badge>`
                  : it.value
          return html`<div class="row" part="row">
            <dt part="term">${it.term}</dt>
            <dd
              part="value"
              ?data-mono=${!!it.mono}
              data-tone=${kind === 'text' ? (it.tone ?? nothing) : nothing}
              ?data-empty=${empty}
            >
              ${body}
            </dd>
          </div>`
        })}
      </dl>
    `
  }
}
