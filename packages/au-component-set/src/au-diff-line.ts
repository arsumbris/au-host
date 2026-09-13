// <au-diff-line> — one line of a code diff (add | del | context), composed inside <au-code-block> to
// render a hunk. Severity WITHOUT a rail: an add/del line is a faint whole-line surface tint plus a +/−
// gutter glyph in the tone colour, never a full coloured edge bar. Layout is a mono grid:
// [old no] [new no] [sign] [code]; numbers + sign are unselectable so a copy-drag yields clean code.
// The code text is the default slot.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuDiffLineElement extends AuElement {
  static properties = {
    kind: { type: String, reflect: true },
    oldNo: { attribute: 'old-no' },
    newNo: { attribute: 'new-no' },
  }
  declare kind: 'add' | 'del' | 'context'
  declare oldNo?: string | number
  declare newNo?: string | number

  constructor() {
    super()
    this.kind = 'context'
  }

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: auto auto auto 1fr;
      align-items: baseline;
      column-gap: var(--au-space-2, 8px);
      padding: 0 var(--au-space-2, 8px);
      color: var(--au-ink-2, #c8c8c8);
      background: transparent;
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-base,20px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      font-variant-numeric: tabular-nums;
    }
    :host([kind='add']) {
      background: color-mix(in oklab, var(--au-color-ok, #3fa66a) 10%, var(--au-color-bg, #14120e));
    }
    :host([kind='del']) {
      background: color-mix(in oklab, var(--au-color-danger, #c0392b) 10%, var(--au-color-bg, #14120e));
    }
    .no {
      min-width: calc(var(--au-space-5,20px) + var(--au-space-1, 4px));
      text-align: right;
      color: var(--au-ink-4, #959083);
      user-select: none;
    }
    :host([kind='add']) .no,
    :host([kind='del']) .no {
      color: var(--au-ink-4, #777);
    }
    .sign {
      width: 1ch;
      text-align: center;
      color: var(--au-ink-4, #777);
      user-select: none;
    }
    :host([kind='add']) .sign {
      color: var(--au-color-ok, #3fa66a);
    }
    :host([kind='del']) .sign {
      color: var(--au-color-danger, #c0392b);
    }
    .code {
      min-width: 0;
      white-space: pre;
      tab-size: 2;
    }
  `

  render() {
    const sign = this.kind === 'add' ? '+' : this.kind === 'del' ? '−' : ''
    return html`
      <span class="no" aria-hidden="true">${this.oldNo ?? ''}</span>
      <span class="no" aria-hidden="true">${this.newNo ?? ''}</span>
      <span class="sign" aria-hidden="true">${sign}</span>
      <code class="code"><slot></slot></code>
    `
  }
}
