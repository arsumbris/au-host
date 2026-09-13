// au-scroll-area provides token-styled scrollbars around overflowing content. It takes no size
// of its own: constrain it through style or parent layout. axis permits both, x or y scrolling.
// The default slot supplies content; scrollbar pseudo-elements style the shadow scroll node.

import { css, html } from 'lit'
import { horizontalScrollFade, measureHorizontalFade } from './scroll-fade'
import { AuElement } from './au-element'
import { scrollbarStyle, scrollContentInset, horizontalScrollContentInset } from './scrollbar-style'
export class AuScrollAreaElement extends AuElement {
  static properties = {
    axis: { type: String, reflect: true },
    content: { type: String, reflect: true },
  }
  declare axis: 'both' | 'x' | 'y'
  declare content: 'flow' | 'center'

  constructor() {
    super()
    this.axis = 'both'
    this.content = 'flow'
  }

  static styles = css`
    :host {
      /*
 * A flex column lets the inner scroll area fill a definite or maximum host height.
 * min-height: 0 allows it to shrink, enabling overflow within a max-height constraint.
 */
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .scroll {
      ${scrollContentInset}
      ${horizontalScrollContentInset}
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      /* Alpha reveals the actual surface, including glass; never paint a guessed background. */
      mask-image: linear-gradient(to bottom, transparent, black var(--_fade-top, 0px),
        black calc(100% - var(--_fade-bottom, 0px)), transparent), linear-gradient(black, black);
      mask-size: 100% 100%, var(--_scrollbar-width, 0px) 100%;
      mask-position: left top, right top;
      mask-repeat: no-repeat;
    }
    :host([content='center']) .scroll { display: flex; flex-direction: column; }
    :host([content='center']) ::slotted(*) {
      flex: none;
      box-sizing: border-box;
      inline-size: 100%;
      margin: auto;
    }
    :host([axis='x']) .scroll {
      padding-inline-end: 0;
      ${horizontalScrollFade}
      overflow-x: auto;
      overflow-y: hidden;
    }
    :host([axis='y']) .scroll {
      padding-block-end: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }
    ${scrollbarStyle(css`.scroll`)}
  `

  /** The scrollable node, so a composer (e.g. au-output-log driving auto-follow) can read scrollTop /
   *  scrollHeight and listen for scroll — the Lit twin of the React ScrollArea's forwarded ref. Null
   *  before the first render. */
  get scrollElement(): HTMLElement | null {
    return (this.renderRoot?.querySelector('.scroll') as HTMLElement | null) ?? null
  }

  #resize = new ResizeObserver(() => this.#scheduleEdges())
  #mutations = new MutationObserver(() => this.#observeContent())
  #frame = 0

  connectedCallback(): void {
    super.connectedCallback()
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      this.#mutations.observe(this, { childList: true, subtree: true, characterData: true })
      this.#observeContent()
    })
  }

  disconnectedCallback(): void {
    this.#resize.disconnect()
    this.#mutations.disconnect()
    cancelAnimationFrame(this.#frame)
    this.#frame = 0
    super.disconnectedCallback()
  }

  updated(): void { this.#scheduleEdges() }

  #observeContent = (): void => {
    this.#resize.disconnect()
    if (this.scrollElement) this.#resize.observe(this.scrollElement)
    // Observe slotted boxes too: loading images, text reflow and async content change the extent.
    for (const child of this.children) this.#resize.observe(child)
    this.#scheduleEdges()
  }

  #scheduleEdges = (): void => {
    if (this.#frame || !this.isConnected) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0
      const el = this.scrollElement
      if (!el) return
      if (this.axis === 'x') measureHorizontalFade(el)
      const top = this.axis === 'x' ? 0 : Math.max(0, el.scrollTop)
      const bottom = this.axis === 'x' ? 0 : Math.max(0, el.scrollHeight - el.clientHeight - top)
      // Ramp with actual scroll distance, without lagging or adding scroll-linked animation.
      el.style.setProperty('--_fade-top', `min(var(--au-scroll-fade-size, var(--au-space-2, 8px)), ${top < 1 ? 0 : top}px)`)
      el.style.setProperty('--_fade-bottom', `min(var(--au-scroll-fade-size, var(--au-space-2, 8px)), ${bottom < 1 ? 0 : bottom}px)`)
      el.style.setProperty('--_scrollbar-width', `${el.offsetWidth - el.clientWidth}px`)
    })
  }

  render() {
    return html`<div class="scroll" part="scroll" @scroll=${this.#scheduleEdges}><slot @slotchange=${this.#observeContent}></slot></div>`
  }
}
