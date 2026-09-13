import { css, type CSSResult } from 'lit'

/** Stable content clearance beside a vertical scrollbar, separate from outer pane padding. */
export const scrollContentInset = css`
  box-sizing: border-box;
  padding-inline-end: var(--au-space-2, 8px);
`

/** Stable clearance above a horizontal scrollbar. */
export const horizontalScrollContentInset = css`
  box-sizing: border-box;
  padding-block-end: var(--au-space-2, 8px);
`

/** Shared scrollbar presentation; each consumer retains its own overflow and scroll behavior. */
export function scrollbarStyle(selector: CSSResult): CSSResult {
  return css`
    ${selector} {
      scrollbar-width: thin;
      scrollbar-color: var(--au-line-3, rgba(255, 255, 255, 0.22)) transparent;
    }
    /* Standard non-auto properties override explicit thumb geometry in Chromium. */
    @supports selector(::-webkit-scrollbar) {
      ${selector} { scrollbar-width: auto; scrollbar-color: auto; }
    }
    ${selector}::-webkit-scrollbar {
      width: var(--au-space-1, 4px);
      height: var(--au-space-1, 4px);
    }
    ${selector}::-webkit-scrollbar-track { background: transparent; }
    ${selector}::-webkit-scrollbar-thumb {
      background: var(--au-line-3, rgba(255, 255, 255, 0.22));
      border-radius: var(--au-radius-pill, 99px);
    }
    ${selector}::-webkit-scrollbar-thumb:hover { background: var(--au-ink-4, #777); }
    ${selector}::-webkit-scrollbar-corner { background: transparent; }
  `
}
