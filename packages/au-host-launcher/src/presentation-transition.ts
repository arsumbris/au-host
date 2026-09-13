import { flushSync } from 'react-dom'

/** Presentation between launcher pages only; does not participate in host readiness. */
export function transitionLauncher(change: () => void): void {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change()
    return
  }
  const transition = document.startViewTransition(() => flushSync(change))
  // A newer user action may supersede an in-flight visual transition.
  void transition.finished.catch(() => {})
}
