// The SHIPPED placeholder-projection: the empty-slot content picker, mounted as a REAL projection into an
// empty slot. It renders the shared PanePicker and FILLS its own slot via the placement seam
// (`setPaneContent` -> `setSlotContent`) — its own pick, or an open-intent it handles. It declares
// `handles: open-intent`, so opening a file into an empty slot routes here by ordinary focus-MRU rules
// and fills the slot in place (no dead-end); the viewer is resolved through the ladder, never hardcoded.
//
// The slot it fills is `host.instanceId` — the position id the driver mounts this placeholder with. A
// fill authors only a viewer TYPE (resolved via `resolveViewer`) plus the file the viewer reads, exactly
// as tabs' preview realization does.

import { createRoot, type Root } from 'react-dom/client'
import { defineProjection, type Intent, type MountFn, type ProjectionModule } from '@arsumbris/au-host-sdk'
import { admitsNoteFor, PanePicker, describeForPicker, resolveViewer, viewerPickOptions } from '@arsumbris/container-kit'
import { placementForPane, setPaneContent, slotAdmits, slotFor } from '@arsumbris/container-core'
import { isOpenIntent, openIntentViewer } from '@arsumbris/intent'
import { isFileSelection } from '@arsumbris/selection'

const mount: MountFn = (container, host) => {
  const slotId = host.instanceId

  // FILL this slot with `config` (a projection instance) via the placement seam, honouring the slot's
  // rules. No-op without a slot id (a mount outside a fillable slot).
  const fill = (config: { type: string; file?: string }): void => {
    if (slotId) setPaneContent(slotId, config)
  }

  // the ADMITS FILTER. Offer only viewers this SLOT admits, so a pick is never refused at the seam.
  // The slot is THIS placeholder's own position, resolved from its occupant id exactly as the fill is
  // (`placementForPane(slotId).slotFor(slotId)`). A slot with no `admits` rule admits everything, so
  // `slotAdmits` returns true for every viewer and the offered list is unchanged. `admits` is checked
  // by CLOSURE through the host-installed provider (shared cross-bundle), never by exact type.
  const slot = slotId ? (() => { const p = placementForPane(slotId); return p ? slotFor(p, slotId) : null })() : null
  const root: Root = createRoot(container)
  const render = (): void => {
    const all = describeForPicker(host)
    const offered = all.filter((d) => slotAdmits(slot, d.type))
    const admitsNote = admitsNoteFor(slot, all.length, offered.length)
    root.render(<PanePicker descriptors={offered} admitsNote={admitsNote} onPick={(id) => fill({ type: id })} />)
  }
  const unsubscribe = host.subscribeContributions(render)
  render()

  // Declare this freshly-mounted EMPTY pane the active view (a non-DOM active-child notion — nothing has DOM
  // focus yet), so an open routes here when the user lands on this empty pane. On later interaction the pane
  // substrate's self-focusing box drives the host's DOM focus tracker, so no pointerdown report is needed.
  host.focus?.report()

  // HANDLE open-intent: a file opened here fills the slot in place with the resolved viewer. The viewer
  // TYPE resolves through the ladder (with > viewer-defaults > sole > must-pick); the file rides the
  // viewer's own config. Declines (falls through to the open-chooser floor) when nothing is eligible.
  const unhandle = host.intent?.handle('open-intent', {
    // CLAIM (pure): resolve the viewer and take it unless NOTHING is eligible (then decline → the floor).
    // `resolveViewer` is pure, so running it in the claim is safe; the COMMIT re-runs it and acts.
    claim: (intent: Intent): boolean => {
      if (!isOpenIntent(intent) || !slotId) return false
      const sel = intent.target
      if (typeof sel === 'string' || !isFileSelection(sel)) return false
      const resolved = resolveViewer(sel.path, host.describeProjections?.(), {
        with: openIntentViewer(intent),
        viewerDefaults: host.viewerDefaults?.(),
      })
      return !('mustPick' in resolved && resolved.mustPick.length === 0)
    },
    commit: (intent: Intent): void => {
      if (!isOpenIntent(intent) || !slotId) return
      const sel = intent.target
      if (typeof sel === 'string' || !isFileSelection(sel)) return
      const path = sel.path
      const descriptors = host.describeProjections?.()
      const resolved = resolveViewer(path, descriptors, {
        with: openIntentViewer(intent),
        viewerDefaults: host.viewerDefaults?.(),
      })
      if ('mustPick' in resolved) {
        if (resolved.mustPick.length === 0) return // claim already declined this (defensive).
        const name = path.split('/').pop() ?? path
        void (async () => {
          const picked = await host.chooser?.choose({
            title: `Open ${name} with`,
            options: viewerPickOptions(resolved.mustPick, descriptors ?? []),
          })
          if (picked) fill({ type: picked, file: path })
        })()
        return
      }
      fill({ type: resolved.viewer, file: path })
    },
  })

  return () => {
    unhandle?.()
    unsubscribe()
    root.unmount()
  }
}

export default defineProjection<ProjectionModule>({ mount })
