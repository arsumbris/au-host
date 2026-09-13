import { css } from 'lit'
import { floatingSurfaceMaterial } from './surface-material'
import { controlFocusStyle } from './focus-style'
import { pickerMotion } from './picker-motion'
import { scrollContentInset } from './scrollbar-style'

/** Shared picker presentation; consumers own selection and action semantics. */
export const pickerSurface = css`
    ${pickerMotion}
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--au-space-3, 12px);
    color: var(--au-ink-1, #e2dfda);
    ${floatingSurfaceMaterial}
    border-radius: var(--au-radius-panel,12px);
    box-shadow: var(--au-elev-5-line), var(--au-sh-pop);
    font-family: var(--au-font-sans,-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: var(--au-t-sm, 13px);
    line-height: var(--au-lh-sm,16px);
    font-variant-numeric: tabular-nums;
    @media (forced-colors: active) {
      outline: 1px solid CanvasText;
      outline-offset: -1px;
    }
`
export const pickerRow = css`
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--au-space-2, 8px);
    padding: var(--au-space-1, 4px) var(--au-space-2, 8px);
    min-height: var(--au-row-h, 32px);
    border-radius: var(--au-radius-row, 8px);
    color: var(--au-ink-2, #d9d6cd);
    background: none;
    border: 0;
    width: 100%;
    text-align: start;
    font: inherit;
    font-weight: var(--au-w-medium, 500);
    cursor: pointer;
    user-select: none;
    transition:
      background var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1)),
      color var(--au-m-fast,160ms) var(--au-e-std,cubic-bezier(0.2, 0, 0, 1));
    @media (prefers-reduced-motion: reduce) { transition: none; }
`
export const pickerRowHover = css`
 color: var(--au-ink-1, #e2dfda);
 background: var(--au-chrome-hover, rgba(255, 255, 255, 0.045));
`
export const pickerRowFocus = css`
 ${pickerRowHover}
 ${controlFocusStyle}
`

export const pickerRowSelected = css`
 color: var(--au-ink-1, #e2dfda);
 background: var(--au-chrome-active);
`

/** Separation between adjacent interactive highlights, without extra outer padding. */
export const pickerRowSeparation = css`margin-block-start: var(--au-space-0-5, 2px);`

/** Apply to the scrolling element itself, keeping highlights clear of its scrollbar. */
export const pickerScrollInset = scrollContentInset
