// <au-tree> + <au-tree-item> — GRAIN REDUCTION. The container provides structure (role=tree) and a
// default slot; the consumer emits `<au-tree-item>` children from its OWN loop. No render-prop. The
// item dispatches a composed `au-select` on activation, so a consumer listens on the tree.

import { reducedControlMotion } from './control-motion'
import { css, html } from 'lit'
import { AuElement } from './au-element'
import { controlFocusStyle } from './focus-style'
export class AuTreeElement extends AuElement {
  static styles = css`
    ${reducedControlMotion}
    :host { display: block; }
    .tree { font: var(--au-tree-font, var(--au-t-sm, 13px)/var(--au-lh-sm, 16px) var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)); }
  `
  private observer = new MutationObserver(() => this.syncTabStop())
  private current?: AuTreeItemElement
  private search = ''
  private searchTime = 0

  private items(): AuTreeItemElement[] {
    return [...this.querySelectorAll<AuTreeItemElement>('au-tree-item')].filter(item => item.closest('au-tree') === this)
  }
  private visible(): AuTreeItemElement[] {
    return this.items().filter(item => {
      let parent = item.parentElement?.closest('au-tree-item') as AuTreeItemElement | null
      while (parent && this.contains(parent)) {
        if (!parent.expanded) return false
        parent = parent.parentElement?.closest('au-tree-item') as AuTreeItemElement | null
      }
      return true
    })
  }
  private syncTabStop(): void {
    const visible = this.visible()
    if (!this.current || !visible.includes(this.current)) {
      let parent = this.current?.parentElement?.closest('au-tree-item') as AuTreeItemElement | null
      while (parent && !visible.includes(parent)) parent = parent.parentElement?.closest('au-tree-item') as AuTreeItemElement | null
      const wasFocused = this.current === this.ownerDocument.activeElement
      this.current = parent ?? visible.find(item => item.selected) ?? visible[0]
      if (wasFocused) this.current?.focus()
    }
    for (const item of this.items()) item.tabIndex = item === this.current ? 0 : -1
  }
  private onFocus = (event: FocusEvent): void => {
    const item = event.composedPath()[0]
    if (item instanceof AuTreeItemElement && item.closest('au-tree') === this) {
      this.current = item
      this.syncTabStop()
    }
  }
  private onKey = (event: KeyboardEvent): void => {
    const item = event.composedPath()[0]
    if (!(item instanceof AuTreeItemElement) || item.closest('au-tree') !== this || event.altKey || event.metaKey || event.ctrlKey) return
    const visible = this.visible(), index = visible.indexOf(item)
    let next: AuTreeItemElement | undefined
    switch (event.key) {
      case 'ArrowDown': next = visible[Math.min(index + 1, visible.length - 1)]; break
      case 'ArrowUp': next = visible[Math.max(index - 1, 0)]; break
      case 'Home': next = visible[0]; break
      case 'End': next = visible.at(-1); break
      case 'ArrowRight':
        if (item.querySelector(':scope > au-tree-item')) {
          if (!item.expanded) item.expanded = true
          else next = visible[index + 1]
        }
        break
      case 'ArrowLeft':
        if (item.expanded) item.expanded = false
        else next = item.parentElement?.closest('au-tree-item') as AuTreeItemElement | undefined
        break
      case 'Enter': case ' ': item.activate(); break
      default: {
        if (event.key.length !== 1) return
        const now = performance.now()
        this.search = now - this.searchTime < 600 ? this.search + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase()
        this.searchTime = now
        const prefix = [...this.search].every(char => char === this.search[0]) ? this.search[0] : this.search
        next = [...visible.slice(index + 1), ...visible.slice(0, index + 1)].find(candidate => candidate.label?.toLocaleLowerCase().startsWith(prefix))
      }
    }
    event.preventDefault()
    event.stopPropagation()
    if (next && this.contains(next)) next.focus()
  }
  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'tree')
    this.addEventListener('keydown', this.onKey)
    this.addEventListener('focusin', this.onFocus)
    this.observer.observe(this, {subtree:true,childList:true,attributes:true,attributeFilter:['expanded','selected']})
    queueMicrotask(() => this.syncTabStop())
  }
  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.observer.disconnect()
    this.removeEventListener('keydown', this.onKey)
    this.removeEventListener('focusin', this.onFocus)
    this.search = ''
  }
  render() {
    return html`<div class="tree" part="tree"><slot></slot></div>`
  }
}

export class AuTreeItemElement extends AuElement {
  static properties = {
    label: { type: String },
    selected: { type: Boolean, reflect: true },
    expanded: { type: Boolean, reflect: true },
    _branch: { state: true },
  }
  declare label?: string
  declare selected: boolean
  declare expanded: boolean
  declare private _branch: boolean

  constructor() {
    super()
    this.selected = false
    this.expanded = false
    this._branch = false
  }

  static styles = css`
    ${reducedControlMotion}
    :host {
      display: block;
      font: var(--au-tree-font, var(--au-t-sm, 13px)/var(--au-lh-sm, 16px) var(--au-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
    }
    .row {
      box-sizing: border-box;
      min-block-size: var(--au-row-h-dense, 24px);
      display: flex;
      align-items: center;
      gap: var(--au-space-1, 4px);
      padding: var(--au-space-1, 4px);
      border-radius: var(--au-tree-item-radius, var(--au-radius-row));
      cursor: pointer;
      color: var(--au-ink-3, #a09c92);
    }
    :host([expanded]) > .row { color: var(--au-ink-2, #d9d6cd); }
    .row:hover { background: var(--au-tree-item-hover, var(--au-chrome-hover)); color: var(--au-ink-2, #d9d6cd); }
    :host([selected]) > .row { background: var(--au-tree-item-selected, var(--au-chrome-active)); color: var(--au-ink-1, #e2dfda); }
    .twist {
      width: var(--au-tree-indent, 16px);
      flex-shrink: 0;
      display: inline-flex;
      justify-content: center;
      font-size: var(--au-t-2xs, 11px);
      color: var(--au-ink-4, #959083);
      transition: transform var(--au-m-fast) var(--au-e-move);
    }
    :host(:focus-visible) .row { ${controlFocusStyle} }
    .row [part="label"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row:hover .twist { color: var(--au-ink-2, #d9d6cd); }
    :host([selected]) > .row .twist { color: var(--au-ink-1, #e2dfda); }
    :host([expanded]) > .row .twist { transform: rotate(90deg); }
    .twist.leaf { visibility: hidden; }
    .children { margin-inline-start: var(--au-tree-indent, 16px); }
    .children[hidden] { display: none; }
  `

  /** A branch when the default slot holds nested tree items. */
  private onSlot(e: Event): void {
    const slot = e.target as HTMLSlotElement
    this._branch = slot.assignedElements().some((el) => el.tagName.toLowerCase() === 'au-tree-item')
  }

  activate(): void {
    this.dispatchEvent(new CustomEvent('au-select', { bubbles: true, composed: true, detail: { label: this.label } }))
  }

  private onRow(): void { this.focus(); this.activate() }

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'treeitem')
    if (!this.closest('au-tree')) this.tabIndex = 0
    this.addEventListener('keydown', this.onStandaloneKey)
  }
  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('keydown', this.onStandaloneKey)
  }
  private onStandaloneKey = (event: KeyboardEvent): void => {
    if (this.closest('au-tree') || event.composedPath()[0] !== this) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.activate() }
    else if (this._branch && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault(); this.expanded = event.key === 'ArrowRight'
    }
  }
  updated(): void {
    this.setAttribute('aria-label', this.label ?? '')
    this.setAttribute('aria-selected', String(this.selected))
    if (this._branch) this.setAttribute('aria-expanded', String(this.expanded))
    else this.removeAttribute('aria-expanded')
  }
  private onTwist(e: Event): void {
    e.stopPropagation() // toggle only, don't also select
    if (!this._branch) return
    this.focus()
    this.expanded = !this.expanded
  }

  render() {
    return html`
      <div class="row" part="item" @click=${this.onRow}>
        <span aria-hidden="true" class="twist ${this._branch ? '' : 'leaf'}" @click=${this.onTwist}>▶</span>
        <span part="label">${this.label ?? ''}</span>
      </div>
      <div class="children" part="children" role="group" ?hidden=${!this.expanded}>
        <slot @slotchange=${this.onSlot}></slot>
      </div>
    `
  }
}
