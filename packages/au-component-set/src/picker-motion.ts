import { css } from 'lit'

/** Motion belongs to the floating surface, not its anchor or scroll viewport. */
export const pickerMotion = css`
  animation: au-picker-in var(--au-m-base, 220ms) var(--au-e-soft, cubic-bezier(0.22, 1, 0.36, 1)) both;
  @media (prefers-reduced-motion: reduce) { animation: none !important; }
`

/** Use an explicit selector: nested `&` does not match a shadow host consistently. */
export const pickerExitMotion = css`
  pointer-events: none;
  animation: au-picker-out var(--au-m-fast, 160ms) var(--au-e-deep, cubic-bezier(0.16, 1, 0.3, 1)) both;
  @media (prefers-reduced-motion: reduce) { animation: none !important; }
`

/** Install at stylesheet scope in every shadow root that renders a picker. */
export const pickerKeyframes = css`
  @keyframes au-picker-in {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: none; }
  }
  @keyframes au-picker-out {
    from { opacity: 1; transform: none; }
    to { opacity: 0; transform: scale(0.98); }
  }
`

/** Make a closing menu inert immediately; release only its own layer after the finite exit. */
export function closePicker(surface: HTMLElement | null, release: () => void): void {
  if (!surface || !surface.isConnected) { release(); return }
  surface.inert = true
  surface.setAttribute('data-state', 'closed')
  const animations = surface.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
  if (!animations.length) { release(); return }
  void Promise.allSettled(animations.map(a => a.finished)).then(release)
}
