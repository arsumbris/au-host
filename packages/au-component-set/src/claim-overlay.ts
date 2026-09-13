// The `ClaimOverlay` Lit mixin — the set's ergonomic wrapper over the component-overlay channel
// (`@arsumbris/component-contract`). A component that needs to draw ABOVE the composition (a menu, a
// popover, a tooltip) mixes this in and calls `this.claimOverlay(level)`; the layer auto-releases on
// `disconnectedCallback`, so a removed component never strands a layer in the ladder.

// The mixin is Lit-shaped, so it lives HERE with the components and NOT in `component-contract`, which
// stays framework-agnostic. It only wraps the framework-neutral `claimHostOverlay`.


import type { LitElement } from 'lit'
import { claimHostOverlay, type OverlayLayer, type OverlayLevel } from '@arsumbris/component-contract'

// The standard TypeScript mixin constructor bound. `any[]` is the documented Lit-mixin shape (the
// base's own constructor args are opaque to the mixin); it never surfaces to a caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T

export interface ClaimOverlayHost {
  /**
   * Claim an overlay layer at `level` (default `overlay`). Returns `null` when no host is present (a
   * standalone render) — the caller must degrade rather than assume a layer. Claiming again releases
   * the previous layer first, so a component holds at most one. Released for you on disconnect.
   */
  claimOverlay(level?: OverlayLevel): OverlayLayer | null
  /** Release the layer this element holds, if any. Idempotent; also called for you on disconnect. */
  releaseOverlay(): void
}

export function ClaimOverlay<T extends Constructor<LitElement>>(
  Base: T,
): T & Constructor<ClaimOverlayHost> {
  class WithOverlay extends Base implements ClaimOverlayHost {
    #layer: OverlayLayer | null = null

    claimOverlay(level: OverlayLevel = 'overlay'): OverlayLayer | null {
      this.releaseOverlay()
      // Pass `this` as the trigger: if this component sits inside a modal's overlay layer, the host nests
      // the popup above it (a select opened inside the command palette floats over the palette, not under).
      this.#layer = claimHostOverlay(level, this)
      return this.#layer
    }

    releaseOverlay(): void {
      this.#layer?.release()
      this.#layer = null
    }

    override disconnectedCallback(): void {
      this.releaseOverlay()
      super.disconnectedCallback()
    }
  }
  return WithOverlay as T & Constructor<ClaimOverlayHost>
}
