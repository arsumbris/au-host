// The shared pane-actions OVERFLOW menu: one `⋯` button that opens the host context-menu with the given
// rows, so a container collapses its occupant-level actions (swap / split / wrap / unwrap / pop-out)
// behind ONE affordance instead of a crowded glyph row. Authored ONCE here so every container COMPOSES
// the same menu instead of hand-rolling a row of buttons and drifting in look and gating (the same
// motivation as PaneActions, one rung up: this shares the whole overflow menu, not a single glyph).
//
// WHAT IT SHARES: the ⋯ button + the menu mechanics — anchored to the button rect, drawn through the
// overlay site, the glyph'd rows. WHAT STAYS PER-CONTAINER: the ACTION VOCABULARY — each container
// builds its own rows (which actions, their gating, their `run`), because a bento leaf (split) and a
// sandwich region (no split) differ. The container owns its child's chrome;
// this gives every container the same overflow affordance.
//
// Rendered as the `<au-icon-button>` / `<au-icon>` custom elements (the side-effect import brings their
// JSX types), matching how the containers already render their chrome glyphs.
import '@arsumbris/au-component-catalog/react' // JSX types for the <au-*> elements
import { type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { ContextMenuItem, MountHost } from '@arsumbris/au-host-sdk'
import { event, on } from '@arsumbris/au-host-sdk'
import { placementForPane, resolveAddress } from '@arsumbris/container-core'
import { holdPaneFrame } from './hold-pane-frame'

/** Development actions address an existing pane without changing its composition. */
export function reloadPaneRows(host: MountHost, paneId: string): ContextMenuItem[] {
  const control = host.projections
  const state = control?.status(paneId)
  if (!control || !state) return []
  return [
    { separator: true },
    { id: 'pane.reload', label: state.busy ? 'Reloading projection…' : 'Reload projection', enabled: !state.busy,
      reason: state.busy ? 'A projection reload is in progress' : undefined,
      run: () => { void control.reload(paneId).catch(() => {}) } },
    { id: 'pane.watch', label: state.watching ? 'Stop live reload' : 'Start live reload', enabled: true,
      run: () => control.setWatching(paneId, !state.watching) },
    ...(state.error ? [{ id: 'pane.reload-error', label: state.error, enabled: false, reason: 'Correct the build and reload again', run: () => {} }] : []),
  ]
}

/**
 * The GENERIC "Open in a new window" (float) pane-action row — the same for EVERY container, because
 * float is a HOST capability (`host.children.pool.float`), not a container's own behaviour. It extracts
 * the occupant through the container's own pure `poolEdit.extractEdit` seam (the drop router's extract),
 * so it works for any container (bento leaf, sandwich region, tabs tab, column item) without each
 * hand-rolling it. Float re-parents the occupant into a host `window` record + realizes an OS surface;
 * the pane keeps its `^:` identity (terminal / view-state follow it). Returns null when the host offers
 * no float (older host) so a container can spread it unconditionally into its rows.
 *
 * Floating is a shared container action, so its menu lives with the other shared actions.
 */
export function floatPaneRow(host: MountHost, paneId: string): ContextMenuItem | null {
  const pool = host.children.pool
  if (!pool?.float) return null
  return {
    id: 'pane.pop-out',
    label: 'Open in a new window',
    icon: 'pop-out',
    enabled: true,
    run: () => {
      const placement = placementForPane(paneId)
      const pe = placement?.poolEdit
      // Trace a refusal instead of bailing silently: a null placement / unpooled container / null extract is
      // then diagnosable (`AU_HOST_EVENTS=move`) rather than a mystery no-op on a clicked affordance.
      if (!placement || !pe || !pe.recordId()) {
        if (on('move')) event('move', 'float-refused', { paneId, reason: pe ? 'not-pooled' : 'no-placement' })
        return
      }
      // Resolve the occupant `^:` to the container's canonical POSITION at the boundary, so `extractEdit`
      // is position-native like every other occupant-addressed seam (a rule-bearing slot's position id ≠ its
      // occupant id, so a raw occupant id would only work by accident of a still-dual transform).
      const pos = resolveAddress(placement, paneId, 'float')
      if (pos == null) {
        if (on('move')) event('move', 'float-refused', { paneId, reason: 'resolve-miss' })
        return
      }
      const ex = pe.extractEdit(pos)
      if (!ex) {
        if (on('move')) event('move', 'float-refused', { paneId, reason: 'extract-null' })
        return
      }
      const title = (ex.occupant.instance as { file?: unknown }).file
      pool.float?.(
        ex.occupant.id,
        { id: pe.recordId(), record: ex.record },
        typeof title === 'string' ? { title: title.split('/').pop() ?? title } : undefined,
      )
    },
  }
}

/**
 * The GENERIC "Move to other window" pane-action row — the same for EVERY container, because
 * moving a subtree across windows is a HOST capability (`host.children.pool.moveToWindow`), not a
 * container's own behaviour. It generalizes `floatPaneRow` ("open in a NEW window") to "move into an
 * EXISTING window": the host shows the target-window picker IN THIS window, then re-parents the subtree
 * (the subtree keeps its `^:`). Present ONLY when another window exists to move into (`otherWindowsExist`),
 * so it is hidden with a single window — and picking the main window from a floated window is the dock-back.
 * The extract + pick live in the host op, so this row is thin (unlike `floatPaneRow`, which pre-extracts).
 * Returns null when the host offers no move (capability unavailable) or there is nowhere to move to.
 */
export function moveToWindowRow(host: MountHost, paneId: string): ContextMenuItem | null {
  const pool = host.children.pool
  if (!pool?.moveToWindow || !pool.otherWindowsExist?.()) return null
  return {
    id: 'pane.move-to-window',
    label: 'Move to other window',
    icon: 'external-link',
    enabled: true,
    run: () => pool.moveToWindow?.(paneId),
  }
}

/**
 * One `⋯` button opening the host context-menu with `rows`. Returns null for an empty set (a fixed or
 * empty slot with nothing to offer), so it is safe to place unconditionally. `label` names the button for
 * accessibility + its hover tooltip ("Pane actions", or a container's own noun like "Tab actions").
 *
 * `rows` may be an ARRAY or a FACTORY. Pass a factory when a row's presence depends on state OUTSIDE this
 * container's own model — e.g. `moveToWindowRow`'s gate (`otherWindowsExist`) turns true when ANOTHER window
 * opens, which is not a change to this container's config, so `useContainerModel` never re-renders it. A
 * factory is re-run each time the menu OPENS, so the menu reflects the CURRENT state — the standard rule
 * that a menu is built when shown, not cached at render. (An array stays correct for purely-own-state rows.)
 */
export function paneActionsMenu(host: MountHost, rows: readonly ContextMenuItem[] | (() => readonly ContextMenuItem[]), label = 'Pane actions', icon = 'more-horizontal'): ReactNode {
  const resolve = (): readonly ContextMenuItem[] => (typeof rows === 'function' ? rows() : rows)
  // Render-time emptiness decides whether the ⋯ shows at all; the container's base rows (swap / wrap) are
  // always present, so a foreign-state row appearing later never needs to CREATE the button, only fill it.
  if (resolve().length === 0) return null
  return (
    <au-icon-button
      label={label}
      onClick={(e: ReactMouseEvent<HTMLElement>) => {
        // A chrome affordance must not bubble to a header's own click (e.g. column's collapse toggle).
        e.stopPropagation()
        const trigger = e.currentTarget
        const menu = host.contextMenu?.open(trigger.getBoundingClientRect(), resolve() as ContextMenuItem[])
        // Hold this pane's frame lit while the menu is open, so the affordance reads as anchored to the pane.
        if (menu?.closed) {
          const release = holdPaneFrame(trigger)
          trigger.setAttribute('aria-expanded', 'true')
          void menu.closed.then(() => { trigger.setAttribute('aria-expanded', 'false'); release() })
        }
      }}
    >
      <au-icon name={icon} />
    </au-icon-button>
  )
}
