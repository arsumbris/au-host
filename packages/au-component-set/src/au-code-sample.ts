// <au-code-sample> — the default set's Lit SHADOW implementation of the `au-code-sample` contract.
//
// A MOCK code editor (themed gutter + syntax-coloured lines) rendered from the `--au-code-*` /
// `--au-editor-*` token ladder. The real editor (CodeMirror, in projections/editor) wears the SAME
// tokens — this is the surface to DIAL the palette: edit the tokens, watch it here, reload the app.
// It is not the editor itself, just a faithful swatch. `active-line` (1-based) gets the gutter +
// wash. TOKEN-ONLY; the per-token syntax hue is the one place a colour legitimately paints (DATA).

import { css, html } from 'lit'
import { AuElement } from './au-element'
import { scrollbarStyle } from './scrollbar-style'

type Tok = 'kw' | 'str' | 'com' | 'fn' | 'type' | 'num' | 'prop' | 'var' | 'punc' | 'txt'
const COLOR: Record<Tok, string> = {
  kw: 'var(--au-code-keyword, #b48ead)',
  str: 'var(--au-code-string, #a3be8c)',
  com: 'var(--au-code-comment, #616e88)',
  fn: 'var(--au-code-function, #88c0d0)',
  type: 'var(--au-code-type, #8fbcbb)',
  num: 'var(--au-code-number, #d08770)',
  prop: 'var(--au-code-property, #81a1c1)',
  var: 'var(--au-code-variable, #d8dee9)',
  punc: 'var(--au-code-punctuation, #7b8394)',
  txt: 'var(--au-ink-2, #c8c8c8)',
}
type Span = [Tok, string]

// A few lines covering every token kind, so the palette reads at a glance.
const SAMPLE: Span[][] = [
  [['com', '// a graph source over the vault']],
  [
    ['kw', 'import'],
    ['txt', ' '],
    ['punc', '{ '],
    ['type', 'GraphSource'],
    ['punc', ' }'],
    ['txt', ' '],
    ['kw', 'from'],
    ['txt', ' '],
    ['str', "'./seam'"],
  ],
  [],
  [
    ['kw', 'export function'],
    ['txt', ' '],
    ['fn', 'open'],
    ['punc', '('],
    ['prop', 'scope'],
    ['punc', ': '],
    ['type', 'Scope'],
    ['punc', ')'],
    ['punc', ': '],
    ['type', 'View'],
    ['txt', ' '],
    ['punc', '{'],
  ],
  [
    ['txt', '  '],
    ['kw', 'const'],
    ['txt', ' '],
    ['var', 'nodes'],
    ['txt', ' '],
    ['punc', '= '],
    ['var', 'source'],
    ['punc', '.'],
    ['fn', 'read'],
    ['punc', '('],
    ['num', '42'],
    ['punc', ')'],
  ],
  [
    ['txt', '  '],
    ['kw', 'return'],
    ['txt', ' '],
    ['punc', '{ '],
    ['prop', 'nodes'],
    ['punc', ', '],
    ['prop', 'live'],
    ['punc', ': '],
    ['num', 'true'],
    ['txt', ' '],
    ['punc', '}'],
  ],
  [['punc', '}']],
]

export class AuCodeSampleElement extends AuElement {
  static properties = {
    activeLine: { type: Number, attribute: 'active-line' },
  }

  declare activeLine: number

  constructor() {
    super()
    this.activeLine = 5
  }

  static styles = css`
    :host {
      display: block;
    }
    .surface {
      background: var(--au-editor-bg, #16181d);
      border: 1px solid var(--au-line-2, rgba(255, 255, 255, 0.06));
      border-radius: var(--au-radius-panel,12px);
      padding: var(--au-space-2, 8px) 0;
      font: var(--au-t-sm)/var(--au-lh-base) var(--au-font-mono);
      overflow: auto;
      box-sizing: border-box;
    }
    ${scrollbarStyle(css`.surface`)}
    .line {
      display: flex;
    }
    .line-active {
      background: var(--au-editor-active-line, rgba(255, 255, 255, 0.04));
    }
    .num {
      flex: 0 0 auto;
      width: 2.5em;
      padding: 0 calc(var(--au-space-2, 8px) + var(--au-space-0-5, 2px)) 0 var(--au-space-3, 12px);
      text-align: right;
      color: var(--au-editor-gutter-fg, #4b515e);
      user-select: none;
      -webkit-user-select: none;
    }
    .num-active {
      color: var(--au-editor-gutter-active, #8a8f9c);
    }
    .code {
      color: var(--au-ink-2, #c8c8c8);
      white-space: pre;
    }
  `

  render() {
    return html`<div class="surface" part="surface">
      ${SAMPLE.map((spans, i) => {
        const n = i + 1
        const active = n === this.activeLine
        return html`<div class="line ${active ? 'line-active' : ''}" part="line">
          <span class="num ${active ? 'num-active' : ''}" part="gutter">${n}</span>
          <code class="code"
            >${spans.length === 0
              ? ' '
              : spans.map(([tok, text]) => html`<span style="color: ${COLOR[tok]}">${text}</span>`)}</code
          >
        </div>`
      })}
    </div>`
  }
}
