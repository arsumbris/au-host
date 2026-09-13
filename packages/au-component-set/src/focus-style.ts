import { css } from 'lit'

/** Quiet, inset keyboard focus shared by compact controls; inherits each theme's focus hue. */
export const controlFocusStyle = css`
  outline: 1px solid var(--au-control-focus, var(--au-focus-outer, #a09c92));
  outline-offset: -1px;
  @media (forced-colors: active) { outline-color: Highlight; }
`
