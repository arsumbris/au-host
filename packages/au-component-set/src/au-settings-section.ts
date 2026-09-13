import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

/** A presentation-only settings group; controls own their values and validation. */
export class AuSettingsSectionElement extends AuElement {
  static properties = {
    heading: { type: String },
    description: { type: String },
    compact: { type: Boolean, reflect: true },
  }
  declare heading?: string
  declare description?: string
  declare compact: boolean
  constructor() { super(); this.compact = false }
  static styles = css`
    :host { display:block; min-width:0; container-type:inline-size; }
    section { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:var(--au-space-5,20px); padding-block:var(--au-space-4,16px); border-block-start:1px solid var(--au-line-1,rgba(245,243,238,0.055)); }
    .intro, .fields { min-width:0; display:flex; flex-direction:column; gap:var(--au-space-2,8px); }
    .fields { gap:var(--au-space-3,12px); }
    h3, p { margin:0; overflow-wrap:anywhere; }
    h3 { font:var(--au-w-strong,590) var(--au-t-sm,13px)/var(--au-lh-base,20px) var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); color:var(--au-ink-1,#e8e8e8); }
    p { font:var(--au-t-sm,13px)/var(--au-lh-base,20px) var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); color:var(--au-ink-3,#9a9a9a); }
    :host([compact]) section { grid-template-columns:minmax(0,1fr); gap:var(--au-space-3,12px); }
    @container (max-width: 38rem) { section { grid-template-columns:minmax(0,1fr); gap:var(--au-space-3,12px); } }
  `
  render() {
    return html`<section part="section" aria-labelledby=${this.heading ? 'heading' : nothing}>
      <div class="intro" part="intro">
        ${this.heading ? html`<h3 id="heading" part="heading">${this.heading}</h3>` : nothing}
        ${this.description ? html`<p part="description">${this.description}</p>` : nothing}
        <slot name="actions"></slot>
      </div>
      <div class="fields" part="fields"><slot></slot></div>
    </section>`
  }
}
