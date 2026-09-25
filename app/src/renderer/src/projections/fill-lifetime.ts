// Runs a caller's `fill` and binds what it returns to the content's lifetime. Every host surface that
// hosts a `FillFn` (popover, preview) goes through this, so a fill's `FillTeardown` runs exactly once,
// when the surface removes the content, including a teardown that resolves only after removal.

import type { FillFn, FillTeardown } from '@arsumbris/au-host-sdk'

export interface FillLifetime {
  /** Settles once the fill has run (sync or async); a rejected async fill settles too, it never rejects. */
  readonly settled: Promise<void>
  /** Run the fill's teardown now, or as soon as the fill yields one. Idempotent. */
  end(): void
}

/** Runs `fill` synchronously (the surface measures right after), then tracks its teardown. */
export function runFill(fill: FillFn, el: HTMLElement, isCurrent: () => boolean): FillLifetime {
  let teardown: FillTeardown | undefined
  let ended = false
  const adopt = (result: void | FillTeardown): void => {
    if (typeof result !== 'function') return
    if (ended) result()
    else teardown = result
  }
  // A synchronous throw propagates to the surface's caller unchanged; an async failure is reported
  // here so the surface's post-fill steps still run against whatever content landed.
  const out = fill(el, isCurrent)
  const settled =
    out instanceof Promise
      ? out.then(adopt, (err: unknown) => console.error('[host] a surface fill rejected', err))
      : (adopt(out), Promise.resolve())
  return {
    settled,
    end(): void {
      if (ended) return
      ended = true
      const t = teardown
      teardown = undefined
      t?.()
    },
  }
}
