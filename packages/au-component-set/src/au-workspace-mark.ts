// <au-workspace-mark> — the workspace initial in a rounded surface tile.
//
// Monochrome by law: surface-2 + an inset hairline (elev-4 line), NEVER a coloured fill, so a
// workspace never introduces a palette of its own. The tile is the `:host`; a consumer places it
// (the switcher trigger, each menu row). TOKEN-ONLY.
//
// Contract: the `name` attribute's first glyph becomes the mark, and labels it for a11y.

import { css, html } from 'lit'
import { AuElement } from './au-element'
export class AuWorkspaceMarkElement extends AuElement {
  static properties = {
    name: { type: String, reflect: true },
  }

  declare name: string

  constructor() {
    super()
    this.name = ''
  }

  static styles = css`
    :host {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: 1.5rem;
      block-size: 1.5rem;
      border-radius: var(--au-radius-sm,5px);
      background: var(--au-color-surface-2, #2a2a2a);
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
      color: var(--au-ink-1, #ededed);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-xs,12px);
      font-weight: var(--au-w-strong,590);
      line-height: 1;
      user-select: none;
    }
  `

  // The mark labels itself for a11y. Set on the host (not an inner span) so the tile IS the img; the
  // rendered glyph stays `aria-hidden` decoration. Kept in sync on every `name` change.
  override updated(): void {
    this.setAttribute('role', 'img')
    this.setAttribute('aria-label', this.name.trim() || 'workspace')
  }

  render() {
    const letter = (this.name.trim()[0] ?? 'W').toUpperCase()
    return html`<span aria-hidden="true">${letter}</span>`
  }
}
