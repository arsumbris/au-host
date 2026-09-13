// Vendored glyph attribution and source records: third-party/lucide-LICENSE and third-party/feather-LICENSE in this package.
// <au-icon> — the default set's Lit SHADOW implementation of the `au-icon` contract.
//
// THE inline-SVG primitive for type-scaled glyphs: a fixed set of 24×24 shapes (thin
// 1.75 stroke, `currentColor`). The paths ship in this module, so a consumer bundle needs nothing
// extra, no font, no sprite.
//
// TOKEN-ONLY SIZING: the `<svg>` is `1em` square and its `font-size` is bound to `@arsumbris/style`'s
// type ramp (`--au-t-*`) by the `size` attribute, so an icon scales with the exact token the text
// around it uses. `color` is inherited (`currentColor`), so an icon takes the ink of its context.
// The `--au-t-*` tokens are inherited custom properties, so they pierce the shadow boundary and
// resolve against the document `:root` where the style package declares them.
//
// Uses `static properties` (not decorators) to keep the build config plain, mirroring <au-button>.

import { css, html, svg, type SVGTemplateResult } from 'lit'
import { AuElement } from './au-element'
// Each glyph is the INNER markup of a `0 0 24 24` svg. Solid marks (grip / dot / more-*) carry an
// explicit fill + no stroke; everything else inherits the outer svg's 1.75 stroke.
const GLYPHS: Record<string, SVGTemplateResult> = {
  history: svg`<path d="M3 11a9 9 0 1 1 2.7 7" /><path d="M3 4v7h7" /><path d="M12 7v5l3 2" />`,
  'chevron-right': svg`<path d="m9 6 6 6-6 6" />`,
  'chevron-down': svg`<path d="m6 9 6 6 6-6" />`,
  'chevron-left': svg`<path d="m15 6-6 6 6 6" />`,
  'chevron-up': svg`<path d="m6 15 6-6 6 6" />`,
  'chevrons-left': svg`<path d="m11 6-6 6 6 6" /><path d="m18 6-6 6 6 6" />`,
  'chevrons-right': svg`<path d="m6 6 6 6-6 6" /><path d="m13 6 6 6-6 6" />`,
  swap: svg`<path d="m16 3 4 4-4 4" /><path d="M4 7h16" /><path d="m8 21-4-4 4-4" /><path d="M20 17H4" />`,
  close: svg`<path d="M18 6 6 18" /><path d="m6 6 12 12" />`,
  folder: svg`<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />`,
  'folder-open': svg`<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />`,
  file: svg`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />`,
  'file-text': svg`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />`,
  edit: svg`<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />`,
  github: svg`<g transform="scale(1.5)" fill="currentColor" stroke="none"><path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" /></g>`,
  star: svg`<path d="M11.54 3.74 Q12.00 2.80 12.46 3.74 L14.44 7.71 Q14.90 8.65 15.93 8.80 L20.32 9.45 Q21.35 9.60 20.60 10.33 L17.43 13.42 Q16.68 14.15 16.86 15.18 L17.60 19.57 Q17.78 20.60 16.86 20.11 L12.92 18.04 Q12.00 17.55 11.08 18.04 L7.14 20.11 Q6.22 20.60 6.40 19.57 L7.14 15.18 Q7.32 14.15 6.57 13.42 L3.40 10.33 Q2.65 9.60 3.68 9.45 L8.07 8.80 Q9.10 8.65 9.56 7.71 Z" />`,
  search: svg`<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />`,
  grip: svg`<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="15" cy="18" r="1.3" /></g>`,
  gear: svg`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />`,
  dot: svg`<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />`,
  back: svg`<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />`,
  forward: svg`<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />`,
  reload: svg`<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />`,
  plus: svg`<path d="M5 12h14" /><path d="M12 5v14" />`,
  minus: svg`<path d="M5 12h14" />`,
  play: svg`<path d="m6 3 14 9-14 9Z" />`,
  check: svg`<path d="M20 6 9 17l-5-5" />`,
  trash: svg`<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" />`,
  copy: svg`<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`,
  'external-link': svg`<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`,
  'more-horizontal': svg`<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></g>`,
  'more-vertical': svg`<g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="12" cy="19" r="1.3" /></g>`,
  'panel-left': svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />`,
  'panel-right': svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" />`,
  'split-right': svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 3v18" />`,
  'split-down': svg`<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 12h18" />`,
  maximize: svg`<path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />`,
  'pop-out': svg`<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" /><rect width="10" height="7" x="12" y="13" rx="2" />`,
  // Dock a floated window back into the main layout — an arrow entering a frame (the inverse of pop-out).
  'pop-in': svg`<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" />`,
  // Wrap a pane in a container — corner brackets enclosing an inner element.
  wrap: svg`<path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" /><rect width="6" height="6" x="9" y="9" rx="1" />`,
  // Unwrap the enclosing container — corner brackets with the child lifting out (an up-arrow).
  unwrap: svg`<path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M16 4h2a2 2 0 0 1 2 2v2" /><path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M12 16V8" /><path d="m9 11 3-3 3 3" />`,
  lock: svg`<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />`,
  globe: svg`<circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="4" ry="9" />`,
  'panel-top': svg`<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" />`,
  terminal: svg`<path d="m4 17 6-6-6-6" /><path d="M12 19h8" />`,
  warning: svg`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />`,
  info: svg`<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />`,
  'alert-circle': svg`<circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />`,
  eye: svg`<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />`,
  sun: svg`<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />`,
  moon: svg`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />`,
  save: svg`<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />`,
}

export const AU_ICON_NAMES = Object.keys(GLYPHS).sort()

export class AuIconElement extends AuElement {
  static properties = {
    name: { type: String, reflect: true },
    size: { type: String, reflect: true },
    // `label` (not `title`): a `title` property would shadow the native HTMLElement.title tooltip.
    label: { type: String },
  }

  declare name?: string
  declare size?: 'xs' | 'sm' | 'md' | 'lg'
  declare label?: string

  static styles = css`
    :host {
      display: inline-flex;
      flex: 0 0 auto;
      vertical-align: -0.125em;
      color: inherit;
      /* The size knob lives on the HOST (md default is the title step of the ramp). Because the svg
         is 1em and inherits this font-size, an INLINE font-size on the host — the numeric escape
         hatch, e.g. style="font-size:40px" — overrides the ramp and flows straight to the glyph. */
      font-size: var(--au-t-title, 20px);
    }
    :host([size='xs']) {
      font-size: var(--au-t-xs, 12px);
    }
    :host([size='sm']) {
      font-size: var(--au-t-body, 16px);
    }
    :host([size='md']) {
      font-size: var(--au-t-title, 20px);
    }
    :host([size='lg']) {
      font-size: var(--au-t-h2, 28px);
    }
    svg {
      /* 1em = the host's (inherited) font-size, so the size knob AND the escape hatch both land here. */
      width: 1em;
      height: 1em;
      overflow: visible;
    }
  `

  render() {
    // A bare or unknown `<au-icon>` renders an empty box rather than throwing (render-resilience).
    const glyph = this.name && Object.hasOwn(GLYPHS, this.name) ? GLYPHS[this.name] : undefined
    const label = this.label?.trim()
    const decorative = !label
    return html`
      <svg
        part="svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        role=${decorative ? 'presentation' : 'img'}
        aria-hidden=${decorative ? 'true' : 'false'}
        aria-label=${label ?? ''}
      >
        ${label ? svg`<title>${label}</title>` : ''}${glyph ?? ''}
      </svg>
    `
  }
}
