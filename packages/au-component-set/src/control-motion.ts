import { css } from 'lit'

/** Controls and surfaces retain state feedback without movement when reduced motion is requested.
 * Scoped to the adopting control's shadow/popup stylesheet; never a page-wide animation reset. */
export const reducedControlMotion = css`
  @media (prefers-reduced-motion: reduce) {
    :host, *, *::before, *::after { transition: none !important; animation: none !important; }
    input::-webkit-slider-thumb { transition: none !important; }
    input::-moz-range-thumb { transition: none !important; }
  }
`
