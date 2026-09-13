// @vitest-environment happy-dom
//
// The overlay site orders layers by the theme's ladder and isolates each claimant's internal z-index.
// Tests assert DOM ordering and isolation declarations. Actual stacking and pointer hit-testing require
// a browser; the DOM tests verify structure and stylesheet rules only.

import { beforeEach, describe, expect, it } from 'vitest'

import { createOverlaySite, DEFAULT_LEVEL, insertionIndexFor, LADDER, OVERLAY_STYLE } from '../src/renderer/src/projections/overlay-site.ts'
import { STYLE as CONFIRM_STYLE } from '../src/renderer/src/projections/confirm-surface.ts'
import { STYLE as NOTIF_STYLE } from '../src/renderer/src/projections/notification-surface.ts'
import { STYLE as PREVIEW_STYLE } from '../src/renderer/src/projections/preview-surface.ts'
import type { OverlayLevel } from '@arsumbris/au-host-sdk'

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
})

const layersOf = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.au-overlay-layer')]
const levelsOf = (): (string | undefined)[] => layersOf().map((l) => l.dataset.level)

/** Replay a claim sequence through the pure sort, yielding the resulting layer order. */
function claimOrder(sequence: readonly OverlayLevel[]): OverlayLevel[] {
  const layers: OverlayLevel[] = []
  for (const level of sequence) layers.splice(insertionIndexFor(layers, level), 0, level)
  return layers
}

describe('the ladder sort — order must not depend on claim timing', () => {
  it('sorts a deliberately reversed claim sequence back into ladder order', () => {
    // The realistic sequence is not this bad, but it is this SHAPE: the persistent host surfaces
    // claim at startup and the inspector claims later, when a user mounts it.
    expect(claimOrder(['tooltip', 'toast', 'popover', 'overlay', 'dropdown', 'sticky', 'raised'])).toEqual([...LADDER])
  })

  it('puts a late LOW claim underneath an early HIGH one', () => {
    // A naive append would put the late one on top regardless, which is the whole defect.
    expect(claimOrder(['toast', 'overlay'])).toEqual(['overlay', 'toast'])
  })

  it('keeps claim order WITHIN one level', () => {
    // Two claimants at one band have said nothing about each other. Claim order is the only stable
    // answer; inventing a tie-break would be the kernel holding placement knowledge nobody gave it.
    expect(insertionIndexFor(['overlay', 'overlay'], 'overlay')).toBe(2)
  })

  it('is stable under EVERY claim order — the property, not three examples', () => {
    // Exhaustive over all 5,040 orderings of a 7-level ladder: whatever sequence they arrive in,
    // the resulting order is the ladder. A sort this small deserves the property rather than cases.
    const permute = <T,>(xs: readonly T[]): T[][] =>
      xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => permute([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]))
    const all = permute(LADDER)
    expect(all).toHaveLength(5040)
    const wrong = all.filter((seq) => claimOrder(seq).join() !== LADDER.join())
    expect(wrong).toEqual([])
  })

  it('appends at the top when nothing sits above', () => {
    expect(insertionIndexFor(['raised', 'overlay'], 'tooltip')).toBe(2)
  })

  it('inserts at the bottom when everything sits above', () => {
    expect(insertionIndexFor(['toast', 'tooltip'], 'raised')).toBe(0)
  })
})

describe('the ladder is named, never numbered', () => {
  it('carries no raw z-index — every band resolves through an --au-z-* token', () => {
    // The ladder values come from `packages/style/ext.css`, so themes can change their spacing.
    expect(OVERLAY_STYLE).not.toMatch(/z-index:\s*\d/)
    for (const level of LADDER) expect(OVERLAY_STYLE).toContain(`z-index: var(--au-z-${level})`)
  })

  it('declares a band for every level on the ladder, and no others', () => {
    // A level in the type with no rule in the stylesheet would silently draw at `auto`.
    const declared = [...OVERLAY_STYLE.matchAll(/data-level='([a-z]+)'/g)].map((m) => m[1])
    expect(declared.sort()).toEqual([...LADDER].sort())
  })

  it('defaults to a level that is ON the ladder', () => {
    expect(LADDER).toContain(DEFAULT_LEVEL)
  })
})

describe('isolation — the property that makes this safe rather than tidy', () => {
  it('makes every layer its own stacking context', () => {
    // Without this, preview's `61 + 2i` cards would still be comparable with a toast's z-index and
    // the collision would only have moved. With it, preview keeps its internal numbers unchanged
    // and they resolve INSIDE its own layer.
    expect(OVERLAY_STYLE).toContain('isolation: isolate')
  })

  it('never lets a LAYER capture the pointer — there is no opt-in, deliberately', () => {
    // A viewport-spanning layer must not intercept input outside its claimant's content. The layer uses
    // `pointer-events: none`, and interactive descendant elements opt back in through inheritance.
    // Assert the absence of a layer-level `interactive` option so input remains bounded to content.
    expect(OVERLAY_STYLE).toContain('pointer-events: none')
    expect(OVERLAY_STYLE).not.toContain('pointer-events: auto')
  })
})

describe('the frame is the host’s — the structural half, over a real document', () => {
  it('creates ONE root, however many layers are claimed', () => {
    const site = createOverlaySite(host)
    site.claim()
    site.claim({ level: 'toast' })
    site.claim({ level: 'tooltip' })
    expect(document.querySelectorAll('.au-overlay-root')).toHaveLength(1)
    expect(layersOf()).toHaveLength(3)
  })

  it('hands back an element INSIDE the root, not loose on the body', () => {
    // The whole point of the site: a claimant never appends to `document.body` again.
    const site = createOverlaySite(host)
    expect(createOverlaySiteLayerParent(site)).toBe('au-overlay-root')
  })

  it('applies the ladder to the real tree, not just to the helper', () => {
    // `insertionIndexFor` is tested exhaustively above; this is the DOM APPLICATION of it, which is
    // a separate thing that can be wrong on its own (an off-by-one in the `insertBefore` sibling
    // lookup would not touch the helper at all).
    const site = createOverlaySite(host)
    site.claim({ level: 'tooltip' })
    site.claim({ level: 'dropdown' })
    site.claim({ level: 'toast' })
    site.claim({ level: 'raised' })
    expect(levelsOf()).toEqual(['raised', 'dropdown', 'toast', 'tooltip'])
  })

  it('puts a LATE low claim underneath an EARLY high one', () => {
    // The realistic sequence: the persistent host surfaces claim at startup, the inspector claims
    // later when a user mounts it. A naive append would put the late one on top regardless.
    const site = createOverlaySite(host)
    site.claim({ level: 'toast' })
    site.claim({ level: 'overlay' })
    expect(levelsOf()).toEqual(['overlay', 'toast'])
  })

  it('release removes the layer and its contents, and is idempotent', () => {
    // Release the layout inspector's layer on unmount so no invisible overlay outlives its claimant.
    const site = createOverlaySite(host)
    const layer = site.claim()
    layer.el.appendChild(document.createElement('span'))
    layer.release()
    expect(layersOf()).toHaveLength(0)
    expect(() => layer.release()).not.toThrow()
    expect(layersOf()).toHaveLength(0)
  })

  it('records the level on the element, which is what the stylesheet selects on', () => {
    const site = createOverlaySite(host)
    expect(site.claim().el.dataset.level).toBe(DEFAULT_LEVEL)
    expect(site.claim({ level: 'tooltip' }).el.dataset.level).toBe('tooltip')
  })

})

describe('nesting — a popup summoned from inside a layer stacks UNDER that layer', () => {
  // THE FIX for the fixed band ladder's blind spot: a `dropdown` is globally below an `overlay`, so a
  // select opened inside a modal palette (`overlay`) would render beneath it. Passing the trigger as
  // `from` nests the popup's layer INSIDE the modal's layer, which — being its own stacking context —
  // floats the popup above the modal while unrelated root layers still order by band.
  const rootOf = (): HTMLElement => host.querySelector('.au-overlay-root') as HTMLElement
  const layerChildren = (el: HTMLElement): HTMLElement[] =>
    [...el.children].filter((c): c is HTMLElement => c.classList.contains('au-overlay-layer'))

  it('nests the new layer under the `from` element’s containing layer, not the root', () => {
    const site = createOverlaySite(host)
    const modal = site.claim({ level: 'overlay' })
    const trigger = document.createElement('button')
    modal.el.appendChild(trigger)
    const popup = site.claim({ level: 'dropdown', from: trigger })
    expect(popup.el.parentElement).toBe(modal.el) // nested, not a root sibling
    expect(layerChildren(rootOf())).toEqual([modal.el]) // the root still holds only the modal
  })

  it('pierces shadow boundaries to find the containing layer', () => {
    // A control is usually nested in shadow roots (au-select inside au-typed-value-editor inside the
    // palette layer); a plain closest() would stop at the first boundary.
    const site = createOverlaySite(host)
    const modal = site.claim({ level: 'overlay' })
    const wrapper = document.createElement('div')
    modal.el.appendChild(wrapper)
    const trigger = document.createElement('button')
    wrapper.attachShadow({ mode: 'open' }).appendChild(trigger)
    const popup = site.claim({ level: 'dropdown', from: trigger })
    expect(popup.el.parentElement).toBe(modal.el)
  })

  it('a claim with no `from` stays a top-level layer (unchanged)', () => {
    const site = createOverlaySite(host)
    site.claim({ level: 'overlay' })
    const p = site.claim({ level: 'dropdown' })
    expect(p.el.parentElement).toBe(rootOf())
  })

  it('a `from` outside any layer is top-level too', () => {
    const site = createOverlaySite(host)
    const loose = document.createElement('button')
    host.appendChild(loose)
    const p = site.claim({ level: 'dropdown', from: loose })
    expect(p.el.parentElement).toBe(rootOf())
  })

  it('orders nested layers by band WITHIN their host layer', () => {
    const site = createOverlaySite(host)
    const modal = site.claim({ level: 'overlay' })
    const t = document.createElement('button')
    modal.el.appendChild(t)
    site.claim({ level: 'tooltip', from: t })
    site.claim({ level: 'dropdown', from: t })
    expect(layerChildren(modal.el).map((l) => l.dataset.level)).toEqual(['dropdown', 'tooltip'])
  })
})

describe('the three migrated surfaces each re-enable pointer events on their own elements', () => {
  // Pointer events inherit from a layer whose value is `none`. Interactive cards, toasts, and backdrops
  // must explicitly restore input. Read the real exported stylesheets so these assertions cover the
  // rules the surfaces use; happy-dom does not perform pointer hit-testing.
  const cases: [string, string, string][] = [
    ['preview card', PREVIEW_STYLE, '.au-pcard { pointer-events: auto;'],
    ['notification toast', NOTIF_STYLE, '.au-notif-toast { pointer-events: auto;'],
    ['confirm backdrop', CONFIRM_STYLE, '.au-confirm-backdrop { pointer-events: auto;'],
  ]
  for (const [name, style, rule] of cases) {
    it(`${name} opts back in`, () => {
      expect(style).toContain(rule)
    })
  }

  it('the preview CONES deliberately stay non-interactive', () => {
    // They are guides drawn under the cards. Making them capture would break the hover-stickiness
    // the whole cone mechanism exists to provide.
    expect(PREVIEW_STYLE).toContain('.au-pcard-cones { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none;')
  })
})

/** The class of a claimed layer's parent — the assertion that it lands inside the host's root. */
function createOverlaySiteLayerParent(site: ReturnType<typeof createOverlaySite>): string | undefined {
  return site.claim().el.parentElement?.className
}
