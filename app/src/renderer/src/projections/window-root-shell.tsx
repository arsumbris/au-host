// THE SHARED WINDOW ROOT SHELL. The window draws the root content's pane header as its top
// chrome — the SAME `<au-pane-header surface="rail">` frame in EVERY window (the main window and every
// popped-out surface), so a subwindow is not a bespoke masthead but the real shell. There is NO separate
// app bar; this header IS the top chrome.
//
// The MAIN window fills the optional `center` with the command palette + composition folder; a SURFACE
// omits them because these authority-owned operations require a surface proxy.
// The co-location difference is thus ONE optional prop, not a different component.

import type { ReactNode } from 'react'

import { paneActionsMenu } from '@arsumbris/container-kit'
import type { ContextMenuItem, MountHost } from '@arsumbris/au-host-sdk'

export function WindowRootShell({
  host,
  rootLabel,
  rootActions,
  isMac,
  zoom,
  center,
  leading,
}: {
  /** The host whose `contextMenu` the root ⋯ opens (a per-window singleton, so any window's host serves). */
  host: MountHost
  /** The root content's type name ("editor" / "bento" / …), the DEFAULT leading label when `leading` is absent. */
  rootLabel: string
  /** Optional leading content that REPLACES the `rootLabel` span. The main window passes a clickable
   *  workspace-name button (opens workspace details); a surface passes nothing and falls back to `rootLabel`. */
  leading?: ReactNode
  /**
   * The root ⋯ menu rows. A subwindow root adds "Move to other window" (dock subsumed); the main
   *  root adds "Wrap" but NOT move (moving the whole main layout out is degenerate — nested moves cover it).
   */
  rootActions: readonly ContextMenuItem[] | (() => readonly ContextMenuItem[])
  /** macOS frameless main window: reserve the traffic-light gap + counter-scale by 1/zoom. A native-framed
   *  surface passes false (its traffic lights sit in the OS titlebar above the web content). */
  isMac: boolean
  zoom: number
  /** The center content (command palette + composition folder). Present on the main window, omitted on a
   *  surface until its authority-owned ops are proxied. */
  center?: ReactNode
}): React.JSX.Element {
  return (
    // The wrap is the OS-window drag region + `position:relative` for the absolutely-centered `center`. On a
    // macOS frameless window it counter-scales so the header matches the fixed-size OS traffic lights and the
    // 100px light gap holds.
    <div
      className={`window-root-header-wrap${isMac ? ' window-root-header-mac' : ''}`}
      style={isMac ? { zoom: 1 / zoom } : undefined}
    >
      <au-pane-header surface="rail" className="window-root-header">
        {/* LEFT: the workspace-name button on the main window, else the root content's type name. */}
        {leading ?? (
          <span slot="leading" className="no-drag window-root-header__title" title={rootLabel}>
            {rootLabel}
          </span>
        )}
        {/* RIGHT: the Root ⋯ acting on the whole root content. */}
        <span slot="actions" className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {paneActionsMenu(host, rootActions, 'Root actions')}
        </span>
      </au-pane-header>
      {/* CENTER (absolutely centered over the bar): the command palette + composition folder — main only. */}
      {center && <div className="window-root-header__center no-drag">{center}</div>}
    </div>
  )
}
