// <au-code-block> — a framed monospace code surface with a copy affordance. An optional head strip
// carries a language <au-chip> on the left and a copy <au-icon-button> on the right; the body is an
// <au-scroll-area axis="x"> so long lines scroll horizontally on a thin tokened bar. `code` renders a
// plain <pre>; omit it and slot composed rows (e.g. diff lines) into the default slot instead. The copy
// button flashes a check for ~1.4s. Composes the au-chip / au-icon-button / au-icon /
// au-scroll-area (all registered by the same set).
//
// `line-start` numbers the `code` lines from that number in an unselectable gutter (the same mono grid
// <au-diff-line> uses), one gutter width for every row. `mark-line` emphasizes one of those lines with the
// accent wash: a whole-row tint, never an edge bar.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuCodeBlockElement extends AuElement {
  static properties = {
    code: { type: String },
    language: { type: String },
    copy: { type: Boolean },
    copyText: { type: String, attribute: 'copy-text' },
    lineStart: { type: Number, attribute: 'line-start' },
    markLine: { type: Number, attribute: 'mark-line' },
    _copied: { state: true },
    _copyFailed: { state: true },
  }
  declare code?: string
  declare language?: string
  declare copy: boolean
  declare copyText?: string
  declare lineStart?: number
  declare markLine?: number
  declare _copied: boolean
  private _copyFailed = false
  private copying = false
  private copyGeneration = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor() {
    super()
    this.copy = true
    this._copied = false
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-radius: var(--au-radius-panel, 12px);
      background: var(--au-elev-3-fill, #15130f);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--au-space-2, 8px);
      padding: var(--au-space-1, 4px) var(--au-space-1, 4px) var(--au-space-1, 4px) var(--au-space-3, 12px);
      border-bottom: 1px solid var(--au-line-1, rgba(255, 255, 255, 0.09));
      min-height: var(--au-row-h, 32px);
    }
    .lang {
      display: inline-flex;
      min-width: 0;
    }
    .spacer {
      flex: 1 1 auto;
    }
    .body {
      padding: var(--au-space-2, 8px) 0;
    }
    pre {
      margin: 0;
      padding: 0 var(--au-space-3, 12px);
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-base,20px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      white-space: pre;
      tab-size: 2;
    }
    .lines {
      display: flex;
      flex-direction: column;
      min-width: max-content;
    }
    /* Numbered lines: one grid for the block, each row a subgrid, so the gutter is as wide as the
       widest number on every row and a marked row's tint spans the whole line. */
    .numbered {
      display: grid;
      grid-template-columns: auto 1fr;
      min-width: max-content;
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-base,20px);
      letter-spacing: var(--au-ls-mono,-0.005em);
    }
    .line {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      column-gap: var(--au-space-3, 12px);
      padding: 0 var(--au-space-3, 12px);
    }
    .line code {
      white-space: pre;
      tab-size: 2;
    }
    .gutter {
      color: var(--au-ink-4, #777);
      text-align: right;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
    .line[data-mark] {
      background: var(--au-accent-soft, rgba(140, 170, 255, 0.12));
      color: var(--au-ink-1, #ededed);
    }
  `

  private onCopy = async (): Promise<void> => {
    if (this.copying) return
    this.copying = true
    const generation = ++this.copyGeneration
    clearTimeout(this.timer)
    this._copied = false
    this._copyFailed = false
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(this.copyText ?? this.code ?? '')
      if (!this.isConnected || generation !== this.copyGeneration) return
      this._copied = true
      this.timer = setTimeout(() => { this._copied = false }, 1400)
    } catch {
      if (this.isConnected && generation === this.copyGeneration) this._copyFailed = true
    } finally {
      if (generation === this.copyGeneration) this.copying = false
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    clearTimeout(this.timer)
    this.copyGeneration++
    this.copying = false
    this._copied = false
    this._copyFailed = false
  }

  private renderNumbered(code: string, start: number) {
    return html`<div class="numbered" part="pre">
      ${code.split('\n').map((text, i) => {
        const n = start + i
        const marked = n === this.markLine
        return html`<div class="line" part=${marked ? 'line mark' : 'line'} ?data-mark=${marked}
          ><span class="gutter" part="gutter" aria-hidden="true">${n}</span><code>${text}</code></div
        >`
      })}
    </div>`
  }

  render() {
    const showHead = Boolean(this.language) || this.copy
    return html`
      ${showHead
        ? html`
            <div class="head" part="head">
              ${this.language
                ? html`<span class="lang"
                    ><au-chip tabindex="-1" aria-hidden="true" label=${this.language}></au-chip
                  ></span>`
                : html`<span class="spacer"></span>`}
              ${this.copy
                ? html`<au-icon-button
                    size="sm"
                    label=${this._copied ? 'Copied' : this._copyFailed ? 'Copy failed. Try again' : 'Copy code'}
                    @click=${this.onCopy}
                    ><au-icon name=${this._copied ? 'check' : this._copyFailed ? 'alert-circle' : 'copy'} size="sm"></au-icon
                  ></au-icon-button>`
                : ''}
            </div>
          `
        : ''}
      <au-scroll-area axis="x" class="body" part="body">
        ${this.code === undefined
          ? html`<div class="lines"><slot></slot></div>`
          : this.lineStart === undefined
            ? html`<pre part="pre"><code>${this.code}</code></pre>`
            : this.renderNumbered(this.code, this.lineStart)}
      </au-scroll-area>
    `
  }
}
