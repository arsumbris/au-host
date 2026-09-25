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
    /* Fat track, thin thumb. The TRACK width is the reserved gutter AND the pointer hit area (native
       scrollbars couple the two), so a wider track gives a generously grabbable scrollbar that is not
       flush against an adjacent resize sash. The visible THUMB stays thin via a transparent border with
       background-clip: padding-box, and thickens on hover for feedback. Layout-stable: hover changes only
       the border width, never the track, so content never reflows. */
    ${selector}::-webkit-scrollbar {
      width: var(--au-space-2, 8px);
      height: var(--au-space-2, 8px);
    }
    ${selector}::-webkit-scrollbar-track { background: transparent; }
    ${selector}::-webkit-scrollbar-thumb {
      background: var(--au-line-3, rgba(255, 255, 255, 0.22));
      border: var(--au-space-0-5, 2px) solid transparent;   /* visible thumb = 8 - 2*2 = 4px */
      border-radius: var(--au-radius-pill, 99px);
      background-clip: padding-box;
    }
    /* Grow + brighten ONLY over the thumb itself (its full border-box = the grabbable band), both at the
       same moment. This is thumb-scoped on purpose: a selector-level :hover would key off the whole
       scrolling content, swelling the thumb whenever the cursor is anywhere in the tree / editor. */
    ${selector}::-webkit-scrollbar-thumb:hover {
      background: var(--au-ink-4, #777);
      border-width: 1px;   /* thumb grows to 6px */
    }
    ${selector}::-webkit-scrollbar-corner { background: transparent; }
  `
}
