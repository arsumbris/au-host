// <au-tree-row> — the default set's Lit SHADOW implementation of the `au-tree-row` contract.
//
// A file-tree ROW: a NavItem shaped for hierarchy. ONE leading column holds the row's affordance — a
// disclosure CHEVRON for a folder (the chevron IS the folder mark; no separate folder glyph), or the
// FILE glyph for a leaf — so a folder's chevron and a file's icon align on one column and nesting reads
// cleanly. `level` drives the indent via `--au-tree-level`. Same monochrome emphasis ladder as
// <au-nav-item>: quiet at rest, a surface LIFT on hover, surface-2 + hairline RING when selected —
// NEVER a left accent bar. A `dirty` row shows a small ink dot at the trailing edge. TOKEN-ONLY.
//
// NESTING GUIDES — a continuous vertical line per ancestor level, drawn behind the content and shown
// when the enclosing tree is hovered. The row draws one segment per ancestor depth (a pure function of
// `level`), each bridging the inter-row gap so the lines read continuous; visibility rides the inherited
// `--au-tree-guide-opacity` custom property, which the CONTAINER flips to 1 on hover (the container owns
// the hover state; the component owns the geometry).
//
// ROVING TABINDEX — the row itself is the SINGLE focusable unit: the parent tree sets the host's `tabindex` (0 on the
// active row, -1 elsewhere — the ARIA-tree roving idiom), `:host(:focus-visible)` carries the ring, and
// the chevron is a NON-FOCUSABLE glyph that only fires `au-toggle`. Nothing to poke post-render.
//
// Events: `au-activate` (row press) + `au-toggle` (disclosure press, folders only), both composed +
// bubbling. The parent owns keyboard nav (arrows / Enter) on the focused row and the toggle wiring.

import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'
import { reducedControlMotion } from './control-motion'
import { controlFocusStyle } from './focus-style'
export class AuTreeRowElement extends AuElement {
  static properties = {
    kind: { type: String, reflect: true },
    level: { type: Number },
    open: { type: Boolean, reflect: true },
    selected: { type: Boolean, reflect: true },
    dirty: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    hasTrailing: { type: Boolean, reflect: true, attribute: 'has-trailing' },
  }

  declare kind: 'folder' | 'file'
  declare level: number
  declare open: boolean
  declare selected: boolean
  declare dirty: boolean
  declare disabled: boolean
  declare hasTrailing: boolean

  constructor() {
    super()
    this.kind = 'file'
    this.level = 0
    this.open = false
    this.selected = false
    this.dirty = false
    this.disabled = false
    this.hasTrailing = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      border-radius: var(--au-radius-row, 8px);
    }
    /* The row body. Box-sizing border-box (shadow default is content-box). position:relative anchors
       the absolute nesting guides. */
    .row {
      position: relative;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: var(--au-space-2, 8px);
      width: 100%;
      /* A tree row takes the NAVIGATION rank: it is a real hit target carrying a name you act on. The
         leading stays on the type ramp's own 13/16 pairing and the height is bought with PADDING, so
         the row breathes around the text rather than inside the line. 16 + 2x8 composes to the 32 rank. */
      min-height: var(--au-row-h, 32px);
      /* Base inset + one indent step per depth level. The step equals the icon rail width, so a child's
         icon lands one full column right of its parent's and the label column stays legible at depth. */
      padding-inline: calc(var(--au-space-1, 4px) + var(--au-tree-level, 0) * var(--au-tree-indent, 16px))
        var(--au-space-2, 8px);
      border-radius: var(--au-radius-row, 8px);
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--au-t-sm, 13px);
      line-height: var(--au-lh-sm, 16px);
      font-weight: var(--au-w-medium, 500);
      letter-spacing: var(--au-ls-snug,-0.02em);
      cursor: pointer;
      user-select: none;
      transition:
        background-color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        box-shadow var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        transform var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    /* ── nesting guides — a continuous vertical line per ancestor level ──
       Absolute, behind the content, bridging the inter-row gap (height + the gap) so stacked segments
       read as one line. Hidden until the enclosing tree is hovered (the container sets the opacity). */
    .guide {
      position: absolute;
      top: 0;
      height: calc(100% + var(--au-space-0-5, 2px));
      width: 1px;
      background: var(--au-line-1, #333);
      opacity: var(--au-tree-guide-opacity, 0);
      transition: opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
      pointer-events: none;
    }

    /* The single leading column: the identity glyph (folder or file), on one aligned rail whose width
       IS the indent step — so one level of nesting moves the glyph exactly one column. */
    .lead {
      position: relative;
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: var(--au-tree-indent, 16px);
      height: var(--au-tree-indent, 16px);
      color: var(--au-ink-4, #777);
      transition: color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }

    /* The disclosure control sits at the TRAILING edge, after the label, so the label's left edge stays
       flush with the rows below it instead of being pushed right by a chevron gutter. Leaves render no
       disclosure at all; the row keeps its trailing padding either way. */
    .disc {
      display: none;
    }
    :host([kind='folder']) .disc {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: var(--au-space-4, 16px);
      height: var(--au-space-4, 16px);
      margin-inline-start: var(--au-space-1, 4px);
      color: var(--au-ink-4, #777);
      opacity: var(--au-tree-disc-opacity, 0.55);
      transition:
        opacity var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
        color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    }
    .row:hover .disc,
    .row[data-sel] .disc {
      opacity: 1;
    }
    /* Closed points right; open rotates it down. */
    .chev {
      width: var(--au-space-4, 16px);
      height: var(--au-space-4, 16px);
      display: block;
      transform: rotate(0deg);
      transition: transform var(--au-m-base,220ms) var(--au-e-move,cubic-bezier(0.77, 0, 0.175, 1));
      cursor: pointer;
    }
    :host([open]) .chev {
      transform: rotate(90deg);
    }

    .label {
      flex: 1 1 auto;
      min-width: 0;
      /* Text supplies the row's breathing room. Trailing controls already have their own padding;
         adding row padding around them would inflate the navigation rank (28 + 16 = 44px). */
      padding-block: var(--au-space-2, 8px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Trailing slot — a right-aligned marker (a diagnostic badge / git letter). Hidden until filled so
       the row gap never opens beside a missing part. */
    .trail {
      display: none;
    }
    :host([has-trailing]) .trail {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--au-space-1, 4px);
      color: var(--au-ink-4, #777);
    }

    /* Dirty (unsaved) marker — a small ink dot at the trailing edge. Never a rail. */
    .dirty {
      display: none;
      flex: none;
      margin-inline-start: var(--au-space-1, 4px);
      width: var(--au-space-2, 8px);
      height: var(--au-space-2, 8px);
      border-radius: 50%;
      background: var(--au-ink-3, #8a8a8a);
    }
    :host([dirty]) .dirty {
      display: inline-block;
    }

    /* ── hover (translucent lift, not a surface-ladder step) ── */
    .row:hover:not([data-sel]),
    :host([data-force-hover]) .row:not([data-sel]) {
      background: var(--au-chrome-hover, rgba(255, 255, 255, 0.05));
      color: var(--au-ink-2, #c8c8c8);
      transform: translateY(calc(var(--au-space-0-5, 2px) * -0.5));
    }
    .row:active:not([data-sel]),
    :host([data-force-active]) .row:not([data-sel]) {
      transform: translateY(0);
    }
    .row:hover:not([data-sel]) .lead,
    :host([data-force-hover]) .row:not([data-sel]) .lead {
      color: var(--au-ink-3, #8a8a8a);
    }

    /* ── selected / active (surface-2 + hairline ring; NO left bar) ── */
    :host([selected]) .row {
      background: var(--au-color-surface-2, #2a2a2a);
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
      color: var(--au-ink-1, #ededed);
    }
    :host([selected]) .lead {
      color: var(--au-ink-2, #c8c8c8);
    }

    /* Open folder — the chevron brightens a step to read as expanded. */
    :host([open]) .lead {
      color: var(--au-ink-3, #8a8a8a);
    }

    /* ── focus (the ROW is the single tab stop; the parent sets the host tabindex) ── */
    :host(:focus-visible) .row,
    :host([data-force-focus]) .row {
      ${controlFocusStyle}
    }
    :host([selected]:focus-visible) .row,
    :host([selected][data-force-focus]) .row {
      box-shadow: var(--au-elev-4-line,inset 0 0 0 1px rgba(245, 243, 238, 0.09));
    }
    :host(:focus) {
      outline: none;
    }

    /* ── disabled ── */
    :host([disabled]) .row,
    :host([data-force-disabled]) .row {
      color: var(--au-ink-5, #555);
      background: none;
      box-shadow: none;
      cursor: default;
      pointer-events: none;
    }
    :host([disabled]) .lead,
    :host([data-force-disabled]) .lead {
      color: var(--au-ink-5, #555);
    }
  `

  // Bridge the `level` PROPERTY to the `--au-tree-level` custom property the indent calc reads. A
  // shadow rule cannot read a host attribute into `calc()`, so the depth is threaded as a host style.
  updated(): void {
    this.style.setProperty('--au-tree-level', String(this.level))
  }

  private onRow(): void {
    if (this.disabled) return
    this.dispatchEvent(new CustomEvent('au-activate', { bubbles: true, composed: true }))
  }

  private onTrailSlot(e: Event): void {
    const slot = e.target as HTMLSlotElement
    this.hasTrailing = slot.assignedNodes({ flatten: true }).some((n) => n.nodeType === Node.ELEMENT_NODE)
  }

  private onChevron(e: MouseEvent): void {
    // The disclosure fires its OWN event and never bubbles into the row's activate — a folder can be
    // opened without being "activated". A file has no chevron, so this is folder-only.
    e.stopPropagation()
    if (this.disabled) return
    this.dispatchEvent(new CustomEvent('au-toggle', { bubbles: true, composed: true }))
  }

  render() {
    const isFolder = this.kind === 'folder'
    // One vertical guide per ancestor level, positioned at each ancestor's leading-column centre.
    const guides = []
    for (let i = 0; i < this.level; i++) {
      guides.push(
        html`<span
          class="guide"
          style="left: calc(var(--au-space-1, 4px) + var(--au-tree-indent, 16px) * ${i} + var(--au-tree-indent, 16px) / 2)"
        ></span>`,
      )
    }
    return html`
      <div
        class="row"
        part="row"
        role="treeitem"
        aria-level=${this.level + 1}
        aria-expanded=${isFolder ? (this.open ? 'true' : 'false') : nothing}
        aria-selected=${this.selected ? 'true' : 'false'}
        aria-disabled=${this.disabled ? 'true' : nothing}
        ?data-sel=${this.selected}
        @click=${this.onRow}
      >
        ${guides}
        <span class="lead" part="lead" aria-hidden="true">
          <slot name="icon"
            ><au-icon
              name=${isFolder ? (this.open ? 'folder-open' : 'folder') : 'file-text'}
              size="xs"
            ></au-icon
          ></slot>
        </span>
        <span class="label" part="label"><slot></slot></span>
        <span class="trail" part="trail"><slot name="trailing" @slotchange=${this.onTrailSlot}></slot></span>
        <span class="dirty" part="dirty" aria-label="Unsaved changes"></span>
        <span class="disc" part="disc" aria-hidden="true">
          ${isFolder
            ? html`<svg
                class="chev"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                focusable="false"
                @click=${this.onChevron}
              >
                <path d="M6 4l4 4-4 4"></path>
              </svg>`
            : nothing}
        </span>
      </div>
    `
  }
}
