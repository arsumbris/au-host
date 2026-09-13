// <au-output-log> — a live, monospace output tail for streaming text (a daemon log). A raised-panel
// surface (surface fill + hairline inset at panel radius, matching a code block) whose body is an
// au-scroll-area (the one hairline scroll primitive), so the tail scrolls on a thin tokened bar.
//
// AUTO-FOLLOW: it rides the newest line down as more arrive, UNTIL the reader scrolls up — then it
// holds and never yanks them back mid-read; scrolling back to the bottom re-arms the follow. It drives
// au-scroll-area's scroll node through the `scrollElement` accessor (the Lit twin of the React
// ScrollArea's forwarded ref) — no reach into another element's internals.
//
// `lines` is the data-in property (newest LAST), capped at `maxLines` (oldest beyond it drop off the
// top). When `lines` is empty/unset, a light-DOM text fallback (the default slot) renders instead — a
// static log authorable as element text, which is also what the gallery preview shows. TOKEN-ONLY.

import { LitElement, css, html } from 'lit'

import { AuElement } from './au-element'
/* A scroll-position tolerance, NOT a style value — a couple of device pixels of slack absorbs sub-pixel
 * rounding, so a log really at the bottom is not read as "scrolled up". */
const STICK_TOLERANCE = 4

export class AuOutputLogElement extends AuElement {
  static properties = {
    lines: { attribute: false },
    maxLines: { type: Number, attribute: 'max-lines' },
  }

  declare lines?: readonly string[]
  declare maxLines: number

  /** Whether the view is pinned to the tail. Starts armed so the first paint lands at the bottom. */
  private _stuck = true
  private _scrollEl: HTMLElement | null = null

  constructor() {
    super()
    this.maxLines = 500
  }

  private readonly _onScroll = (): void => {
    const el = this._scrollEl
    if (!el) return
    this._stuck = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TOLERANCE
  }

  private _followTail(): void {
    const el = this._scrollEl
    if (el && this._stuck) el.scrollTop = el.scrollHeight
  }

  async firstUpdated(): Promise<void> {
    const sa = this.renderRoot.querySelector('au-scroll-area') as
      | (LitElement & { scrollElement: HTMLElement | null })
      | null
    if (!sa) return
    // The composed au-scroll-area upgrades independently; wait for its first render before its scroll
    // node exists.
    if (typeof sa.updateComplete?.then === 'function') await sa.updateComplete
    this._scrollEl = sa.scrollElement
    this._scrollEl?.addEventListener('scroll', this._onScroll, { passive: true })
    this._followTail()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this._scrollEl?.removeEventListener('scroll', this._onScroll)
  }

  updated(): void {
    // Runs after the new lines render, before browser paint — the jump to the newest line is unseen.
    this._followTail()
  }

  static styles = css`
    :host {
      /* A flex column with min-height:0 so a definite OR max- height from the caller clamps it and the
         inner scroll actually engages (the same reasoning as au-scroll-area's own host). */
      display: flex;
      flex-direction: column;
      min-height: 0;
      box-sizing: border-box;
      border-radius: var(--au-radius-panel,12px);
      background: var(--au-elev-3-fill, #23262e);
      box-shadow: var(--au-elev-3-line,inset 0 0 0 1px rgba(245, 243, 238, 0.055));
      padding: var(--au-space-2, 8px) 0;
    }
    au-scroll-area {
      flex: 1;
      min-height: 0;
    }
    .pre {
      margin: 0;
      padding: 0 var(--au-space-3, 12px);
      color: var(--au-ink-2, #c8c8c8);
      font-family: var(--au-font-mono,ui-monospace, "SF Mono", monospace);
      font-size: var(--au-t-xs, 12px);
      line-height: var(--au-lh-base,20px);
      letter-spacing: var(--au-ls-mono,-0.005em);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 2;
    }
  `

  render() {
    const all = this.lines
    const shown =
      all && all.length > this.maxLines ? all.slice(all.length - this.maxLines) : all
    return html`
      <au-scroll-area axis="y" role="log" aria-live="polite">
        <pre class="pre" part="pre">${shown && shown.length ? shown.join('\n') : html`<slot></slot>`}</pre>
      </au-scroll-area>
    `
  }
}
