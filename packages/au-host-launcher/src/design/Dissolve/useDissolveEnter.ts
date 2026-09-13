import { useCallback, useRef, useState, type RefObject } from 'react'
import type { MistHandle } from '../Mist/mistEngine'

export type DissolvePhase = 'idle' | 'entering' | 'done'

export interface UseDissolveEnterOptions {
  /** The mist to blow away on enter. Its `D` is tweened 0→1 in lockstep with the content transition. */
  mist?: RefObject<MistHandle | null>
  /** Tween length (ms) for BOTH the mist dissolve and the content transition. Defaults to the shared --au-m-slow token. */
  duration?: number
  /** Easing for the mist dissolve tween. Default: the engine's ease-out cubic. */
  easing?: (t: number) => number
}

export interface DissolveController {
  /** Current phase — drive the `<Dissolve>` wrapper (or your own classes) off this. */
  phase: DissolvePhase
  /** The duration in effect (ms) — feed it to the wrapper so CSS + mist share one clock. */
  duration: number
  /** Resolves when the tween completes. */
  enter: () => Promise<void>
  /** Reset to idle (re-form the mist, restore the launcher). */
  reset: () => void
}

/**
 * The launcher's "dissolve into the app" behaviour, factored out of any one screen: `enter` tweens
 * the Mist's `D` 0→1 while flipping a `phase` a wrapper uses to fade+scale the launcher OUT and
 * reveal the app underneath. Pair with `<Dissolve>` for the paved path, or read `phase` and roll
 * your own. Reduced motion collapses to a snap — the mist engine already snaps `D`, and the CSS
 * durations collapse via the motion tokens.
 */
export function useDissolveEnter(opts: UseDissolveEnterOptions = {}): DissolveController {
  const { mist, easing } = opts
  const token = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--au-m-slow').trim()
  const tokenMs = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
  const duration = opts.duration ?? (Number.isFinite(tokenMs) ? tokenMs : 0)
  const [phase, setPhase] = useState<DissolvePhase>('idle')
  const busy = useRef(false)
  const attempt = useRef(0)

  const enter = useCallback(async (): Promise<void> => {
    if (busy.current || phase !== 'idle') return
    busy.current = true
    const mine = attempt.current
    setPhase('entering')
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    // Without a mist controller the CSS transition still needs its own lifetime.
    // Keep the launcher mounted through the fade instead of resolving in the same frame.
    if (!reduced) await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (mine !== attempt.current) return
    await (mist?.current?.dissolve({ duration: reduced ? 0 : duration, easing })
      ?? new Promise<void>((resolve) => setTimeout(resolve, reduced ? 0 : duration)))
    // `reset` RESOLVES the tween we are suspended on (mistEngine's setD drops it), so a reset mid-enter
    // hands control straight back here. Superseded attempts MUST NOT stamp 'done' over the reset.
    if (mine !== attempt.current) return
    setPhase('done')
    busy.current = false
  }, [mist, duration, easing, phase])

  const reset = useCallback((): void => {
    attempt.current += 1
    busy.current = false
    setPhase('idle')
    mist?.current?.setD(0)
  }, [mist])

  return { phase, duration, enter, reset }
}
