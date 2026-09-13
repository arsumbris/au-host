// @vitest-environment happy-dom
//
// THE OUT-OF-BOUNDS DOM DETECTOR —.
//
// WHAT IS ACTUALLY BEING TESTED. The value of this detector is a single classification: given a node
// appended to `document.body`, is it a sanctioned owner (the composition root, the overlay site) or an
// escape? Everything else is MutationObserver plumbing. So the pure `isOutOfBounds` carries the weight
// and is tested exhaustively; the shell test proves the observer wires the pure verdict to a report.
//
// A fake DOM is not a browser, but it does not need to be here: this check is about DOM STRUCTURE
// (which element sits where), not layout or paint. happy-dom's childList MutationObserver is exactly
// the surface under test. The load-bearing visual claim (isolation contains a z-index) belongs to the
// overlay site's own in-app verification, not here.

import { afterEach, describe, expect, it } from 'vitest'

import { setHostDiagnosticSink, type HostDiagnostic } from '@arsumbris/au-host-sdk'

import {
  describeNode,
  installDomBoundsDetector,
  isOutOfBounds,
  OUT_OF_BOUNDS_CODE,
  type DomBoundsContext,
} from '../src/renderer/src/projections/dom-bounds-detector'

const OVERLAY_CLASS = 'au-overlay-root'

function ctx(appRoot: Element | null): DomBoundsContext {
  return { appRoot, overlayRootClass: OVERLAY_CLASS }
}

afterEach(() => {
  setHostDiagnosticSink(null)
  document.body.replaceChildren()
})

describe('isOutOfBounds — the classification that is the whole point', () => {
  it('flags an arbitrary element appended to the body', () => {
    const el = document.createElement('div')
    expect(isOutOfBounds(el, ctx(null))).toBe(true)
  })

  it('does NOT flag the composition root', () => {
    const root = document.createElement('div')
    root.id = 'root'
    // The verdict must key on identity, not on the id string: a different element with id="root"
    // is still an escape. Only the captured appRoot is exempt.
    expect(isOutOfBounds(root, ctx(root))).toBe(false)
    const impostor = document.createElement('div')
    impostor.id = 'root'
    expect(isOutOfBounds(impostor, ctx(root))).toBe(true)
  })

  it('does NOT flag the overlay site root, recognized by class', () => {
    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS
    expect(isOutOfBounds(overlay, ctx(null))).toBe(false)
  })

  it('does NOT flag non-element nodes (text, comment)', () => {
    expect(isOutOfBounds(document.createTextNode('whitespace'), ctx(null))).toBe(false)
    expect(isOutOfBounds(document.createComment('note'), ctx(null))).toBe(false)
  })
})

describe('describeNode — a stable label for the offender', () => {
  it('renders tag, id and classes', () => {
    const el = document.createElement('section')
    el.id = 'menu'
    el.className = 'a b'
    expect(describeNode(el)).toBe('section#menu.a.b')
  })

  it('omits absent parts', () => {
    expect(describeNode(document.createElement('div'))).toBe('div')
  })
})

describe('installDomBoundsDetector — the observer wires the verdict to a report', () => {
  function capture(): HostDiagnostic[] {
    const seen: HostDiagnostic[] = []
    setHostDiagnosticSink((d) => seen.push(d))
    return seen
  }

  // MutationObserver delivers asynchronously; flush the microtask/macrotask queue.
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('reports an escape, with the code and a subject', async () => {
    const seen = capture()
    const disconnect = installDomBoundsDetector()

    const escape = document.createElement('div')
    escape.className = 'rogue-popup'
    document.body.appendChild(escape)
    await flush()

    expect(seen).toHaveLength(1)
    expect(seen[0].code).toBe(OUT_OF_BOUNDS_CODE)
    expect(seen[0].severity).toBe('warning')
    expect(seen[0].subject).toBe('div.rogue-popup')
    disconnect()
  })

  it('stays SILENT for the overlay site root (the site\'s own lazy append)', async () => {
    const seen = capture()
    const disconnect = installDomBoundsDetector()

    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS
    document.body.appendChild(overlay)
    await flush()

    expect(seen).toHaveLength(0)
    disconnect()
  })

  it('stops reporting after disconnect', async () => {
    const seen = capture()
    const disconnect = installDomBoundsDetector()
    disconnect()

    document.body.appendChild(document.createElement('div'))
    await flush()

    expect(seen).toHaveLength(0)
  })
})
