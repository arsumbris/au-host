// Native-DnD → host bridge for a dropped SELECTION,
// WITH the live drop-zone highlight.
//
// aup-reader makes each [[wikilink]] a NATIVE drag source: its `dataTransfer` carries a `link-selection`
// under `application/x-au-selection+json`, plus a `text/plain` fallback for external paste. This bridge
// lets that drop LAND on a pane and OPEN there, and shows WHERE it will land while you drag.
//
// TWO halves, split by what each needs:
//  - the DROP-ZONE HIGHLIGHT lives HERE (container-kit): during a native `dragover` it feeds the shared
//    drag store, so the one host-mounted `DragOverlay` renders the SAME zone band (center = tab,
//    edge = split) a dragged pane shows — one preview mechanism, not two. The overlay draws only the
//    band + receiver outline (no ghost), which is exactly right over a native drag that has its own
//    drag image.
//  - the OPEN needs `host.engine` (to resolve `[[ref]]`→path) + discovery (to pick the viewer), so — like
//    `onDrop`/the drop router — the HOST installs the opener; this module reads the MIME on `drop` and
//    hands the parsed selection + point to it.

import { dragStore, resolveTargetsAll, type DragSource } from '@arsumbris/container-core'

/** The MIME a projection writes a serialized `Selection` under (aup-reader's wikilink drag source). */
export const SELECTION_DRAG_MIME = 'application/x-au-selection+json'

export interface SelectionDropPoint {
  clientX: number
  clientY: number
}

// A permissive, TYPELESS synthetic source for the drop-zone affordance. It drives the SAME zone preview
// (`DragOverlay`) a pane drag shows, by feeding the shared drag store. Typeless because the file's
// viewer is resolved HOST-SIDE at drop, not known during dragover — so an `admits`-constrained slot
// correctly does NOT light up (`slotAdmits` refuses an unknown type), while an unconstrained slot (the
// common case) shows the band. `__external__` never matches a real container, and `start()` is called
// with no source element, so even a stray `end()` makes `routeDrop` no-op (`findContainerRoot(null)`).
const AFFORDANCE_SOURCE: DragSource = {
  containerKind: '__external__',
  localId: '__selection-drop__',
  role: 'pane',
  label: '',
}

/**
 * Install the native selection-drop bridge on a root element (the app root / document body). Returns a
 * detach fn.
 * - `dragover` carrying the selection MIME: enables the drop and drives the drop-zone highlight (feeds
 *   the shared drag store; the host `DragOverlay` renders the band).
 * - `drop`: clears the highlight, parses the JSON, and calls `onDrop(selection, point)`.
 *
 * `selection` is handed back as the parsed JSON (`unknown`) — the HOST owns the selection vocabulary
 * (`@arsumbris/selection`) and narrows it. Malformed JSON, or a drag not carrying the MIME, is ignored
 * (a foreign drag the app does not own). The producer's `text/plain` fallback is untouched, so an
 * external drop target still receives `[[ref]]`.
 */
export function installSelectionDrop(
  root: HTMLElement,
  onDrop: (selection: unknown, point: SelectionDropPoint) => void,
): () => void {
  const carries = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SELECTION_DRAG_MIME)

  // Whether we have started an affordance drag in the shared store (so we clear exactly once).
  let active = false
  const clearHighlight = (): void => {
    if (!active) return
    active = false
    dragStore.getState().cancel()
  }

  const onDragOver = (e: DragEvent): void => {
    if (!carries(e)) return
    e.preventDefault() // a dragover that preventDefaults is what makes the element a drop target
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    // Drive the SAME drop-zone preview a pane drag shows: start the shared store once, then push the
    // DEEPEST target under the cursor as the hover (matching the router's deepest-wins).
    if (!active) {
      active = true
      dragStore.getState().start(AFFORDANCE_SOURCE)
    }
    dragStore.getState().setHover(resolveTargetsAll(e.clientX, e.clientY, AFFORDANCE_SOURCE)[0] ?? null)
  }

  const onNativeDrop = (e: DragEvent): void => {
    if (!carries(e)) return
    e.preventDefault()
    clearHighlight()
    const raw = e.dataTransfer?.getData(SELECTION_DRAG_MIME)
    if (!raw) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return // a malformed / foreign payload — ignore
    }
    onDrop(parsed, { clientX: e.clientX, clientY: e.clientY })
  }

  // `dragend` fires on the source and bubbles to the root — it covers every end `drop` does not (a drop
  // outside any pane, Esc, an aborted drag), so the band never sticks.
  const onDragEnd = (): void => clearHighlight()
  // Leaving the root bounds clears the otherwise-frozen band (dragover stops firing outside the window);
  // a bounds check, not `relatedTarget`, so an INTERNAL boundary crossing never flickers it.
  const onDragLeave = (e: DragEvent): void => {
    if (!active) return
    const r = root.getBoundingClientRect()
    if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) clearHighlight()
  }

  root.addEventListener('dragover', onDragOver)
  root.addEventListener('drop', onNativeDrop)
  root.addEventListener('dragend', onDragEnd)
  root.addEventListener('dragleave', onDragLeave)
  return () => {
    root.removeEventListener('dragover', onDragOver)
    root.removeEventListener('drop', onNativeDrop)
    root.removeEventListener('dragend', onDragEnd)
    root.removeEventListener('dragleave', onDragLeave)
    clearHighlight()
  }
}
