import { reloadPaneRows } from '@arsumbris/container-kit'
// The SURFACE renderer entry — the mount agent's boot (the new cross-window path).
//
// A surface is a secondary window the AUTHORITY drives. This window owns no pool, no dispatch, no wire
// table: it boots EMPTY, signals ready, then a `MountAgent` executes the authority's SurfaceCommands
// into its DOM and reports SurfaceEvents back up. Engine reads reuse the entry-keyed IPC (window.main);
// the layered proxied host lives in the MountAgent.
//
// A thin `<au-*>` CHROME BAR sits above the content: the floated pane's title + a POP-BACK (dock) button
// that reports a `dock` event up, so the authority re-parents this surface's content into the main window
// and closes the OS window (see `surfaceChromeBar`).

import './dev-flag' // MUST be first — sets the DEV split-bridge flag before container-core's eager init evals

// The FOUNDATION typeface (@font-face for Geist), so the `--au-font-*` the tokens name actually load —
// document-global, like the main window's boot.
import '@arsumbris/style/fonts.css'
import '@arsumbris/style/tokens.css'
import '@arsumbris/style/ext.css'
import './app.css'

import { createRoot } from 'react-dom/client'
import { DragOverlay, moveToWindowRow } from '@arsumbris/container-kit'

import { subscribeTypes, type TypedSubscriber, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { installDiagnosticConditionBridge, subscribe as subscribeEvents, readSince as readEventsSince } from '@arsumbris/au-host-sdk'

import { discoverProjections } from './projections/discovery'
import { discoverMembers } from './projections/members'
import { discoverComponentSets, discoverComponents } from './projections/component-discovery'
import { registerComponentSets } from './projections/component-registry'
import { getActiveLook } from './projections/active-set-store'
import { installComponentOverlayChannel, overlaySiteHasBlockingLayer } from './projections/overlay-site'
import { installKeybindGate } from './projections/keybind-gate'
import { installEventReadBridge } from './projections/event-read-bridge'
import { createEngineReadiness } from './projections/engine-readiness'
import { MountAgent } from './projections/mount-agent'
import { paneIdOfActiveElement } from './projections/pane-focus'
import { WindowRootShell } from './projections/window-root-shell'
import { isMacRenderer } from './projections/platform'
import { applyStoredTheme } from './projections/theme-store'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { discoverGroupingContainers, discoverSpatialContainers, installGroupingProvider, installWrapTargets } from './projections/grouping-discovery'
import type { SurfaceCommand, SurfaceInit } from '../../shared/daemon-api'

// This surface runs its own event substrate (per-window scope), so bridge its diagnostics into its own
// condition set, matching the main window. Once, at boot.
installDiagnosticConditionBridge()
// This surface has its own per-window overlay site, so publish its `claim` to the component-overlay
// channel too. Once, at boot.
installComponentOverlayChannel()
// The gated `window.__auEvents` read bridge for this surface (E2E / debugging), mirroring the main window.
installEventReadBridge()

// TRACE RELAY: this surface has its OWN per-renderer event substrate, so its container / viewer /
// resync decisions land in a ring the authority's `trace-inspector` never sees. Forward each new event UP to
// the authority (a PULL-SAFE subscriber — never on the emit path), which re-records it with a `surface`
// attribution field. A cursor on the monotonic `seq` forwards only new events via `readSince` — an O(new)
// tail walk, not an O(ring) rescan per notify; the ring holds traces AND condition raises/clears,
// so both cross. The cause is carried as-is: a surface never mints one (it has no IntentTree), so it is
// absent or the authority's own (resumed during a commit) and threads correctly there.
let traceCursor = 0
subscribeEvents(() => {
  for (const e of readEventsSince(traceCursor)) {
    traceCursor = e.seq
    window.main.surface.sendEvent({ kind: 'trace', event: e })
  }
})

// The command executor + a BUFFER for commands that arrive before the agent is built. The authority
// drives the first mount the instant this surface signals ready (below), but the agent is built only
// after async discovery — so `onCommand` is wired NOW (before ready), and an early command is buffered
// and replayed once the agent exists. Without this the first mount races the boot and is dropped.
let agent: MountAgent | null = null
const pending: SurfaceCommand[] = []
window.main.surface.onCommand((command) => {
  if (agent) agent.execute(command)
  else pending.push(command)
})

const root = document.getElementById('root')!
const status = (msg: string): void => {
  root.replaceChildren()
  root.style.display = 'grid'
  root.style.placeItems = 'center'
  root.textContent = msg
}

// The subwindow's root ⋯ menu is now the SHARED "Move to other window" row (appended inside
// `WindowRootShell`) — dock is subsumed (its picker includes the main window). No bespoke dock action here.

async function boot(init: SurfaceInit): Promise<void> {
  document.title = init.surfaceId
  // Apply the saved theme + tweaks (the per-machine app-global layer), so a floated window matches the main
  // window instead of the raw token defaults. localStorage is per-origin, shared across this app's windows,
  // so the surface reads the SAME active theme the main window persisted. (Mirrors ProjectionHost's boot.)
  applyStoredTheme()
  status('loading…')

  const reader: WireReader = { read: (request) => window.main.engine.read(init.entryPath, request) }
  try {
    const [discovery, members] = await Promise.all([discoverProjections(reader), discoverMembers(reader)])

    // Register the `<au-*>` component set into THIS window's custom-element registry, mirroring the main
    // window's ProjectionHost boot — otherwise a projection's `<au-icon>` / `<au-*>` chrome never upgrades
    // and it renders unstyled. Each renderer has its OWN registry, so a surface must define them itself.
    const [componentSets, componentDefs] = await Promise.all([discoverComponentSets(reader), discoverComponents(reader)])
    const reg = await registerComponentSets(componentSets, componentDefs, getActiveLook())
    for (const d of reg.diagnostics) console.warn(d)

    // Populate THIS window's GROUPING registry from the type graph, mirroring ProjectionHost.
    // Container-core's grouping lookup is a per-renderer module singleton, so without this a floated
    // container's WRAP finds no grouping container (`groupingForNewGroup()` null → `no-grouping`) and the
    // mint over the wire is never reached. The composition-level `group-into` is authority-owned, so a
    // surface installs the discovered capabilities only.
    const [groupingCaps, spatialCaps] = await Promise.all([discoverGroupingContainers(reader), discoverSpatialContainers(reader)])
    installGroupingProvider(groupingCaps)
    installWrapTargets(groupingCaps, spatialCaps)

    // The content mount box — a flex:1 area in a flex-column root that fills the window, mirroring a
    // bento pane's content area so a projection that fills via flex:1 / height:100% resolves against a
    // definite, window-sized parent and reflows on resize.
    root.replaceChildren()
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.placeItems = ''
    root.style.alignItems = 'stretch'

    // THE SHARED WINDOW ROOT SHELL — the SAME `<au-pane-header>` chrome as the main window, minus
    // the palette + composition folder. Its own React root above the content; the
    // MountAgent feeds it the root host + label via `onRoot`. isMac reserves the traffic-light gap: a surface
    // window is framed like the main one (hiddenInset + traffic lights over the shell), not native-framed.
    // zoom=1 — a surface window is not web-zoomed, so the mac counter-scale is a no-op.
    const isMac = isMacRenderer()
    const headerHost = document.createElement('div')
    headerHost.style.flex = '0 0 auto'
    root.appendChild(headerHost)
    const headerRoot = createRoot(headerHost)
    const renderHeader = (info: { host: MountHost; label: string; id: string } | null): void => {
      // A subwindow root's only ⋯ action is "Move to other window" (dock subsumed — its picker
      // includes the main window). A secondary window always has >=2 windows, so the row is always present.
      const moveRow = info ? moveToWindowRow(info.host, info.id) : null
      headerRoot.render(
        info ? <WindowRootShell host={info.host} rootLabel={info.label} rootActions={() => [...(moveRow ? [moveRow] : []), ...reloadPaneRows(info.host, info.id)]} isMac={isMac} zoom={1} /> : null,
      )
    }
    renderHeader(null)

    const contentEl = document.createElement('div')
    contentEl.style.flex = '1'
    contentEl.style.minHeight = '0'
    contentEl.style.overflow = 'hidden'
    root.appendChild(contentEl)

    agent = new MountAgent(
      init,
      discovery.projections,
      members,
      (event) => window.main.surface.sendEvent(event),
      contentEl,
      (info) => renderHeader(info),
    )
    const subscriber: TypedSubscriber = { subscribe: (request, listener) => window.main.engine.subscribe(init.entryPath, request, listener) }
    const readiness = createEngineReadiness(init.entryPath)
    let disposed = false
    let detach: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let refreshGeneration = 0
    const refresh = async (): Promise<void> => {
      const generation = ++refreshGeneration
      try {
        const [next, grouping, spatial] = await Promise.all([
          discoverProjections(reader), discoverGroupingContainers(reader), discoverSpatialContainers(reader),
        ])
        if (!disposed && generation === refreshGeneration) {
          installGroupingProvider(grouping)
          installWrapTargets(grouping, spatial)
          agent?.updateDiscovery(next.projections)
        }
      } catch (error) { console.error('Surface discovery failed:', error) }
    }
    const openDiscovery = (): void => {
      if (disposed || detach) return
      detach = subscribeTypes(subscriber, event => {
        if (event.kind === 'closed') { detach = undefined; return }
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => { void refresh() }, 200)
      })
    }
    openDiscovery()
    const offReady = readiness.subscribe(ready => { if (ready) { openDiscovery(); void refresh() } })
    window.addEventListener('unload', () => {
      disposed = true
      if (refreshTimer) clearTimeout(refreshTimer)
      detach?.(); offReady(); readiness.dispose()
    }, { once: true })

    // Drain any commands that arrived before the agent was built (the ready-handshake race).
    for (const command of pending.splice(0)) agent.execute(command)

    // THE KEYBIND GATE — the surface's window-local half, the SAME gate the main window
    // installs. It canonicalizes + guards + arbitrates each keydown HERE (so plain typing never leaves the
    // window); a surviving chord candidate is forwarded UP to the authority, which resolves + fires. The gate
    // `preventDefault`s a native default ONLY for a chord that BEGINS a bound binding (the authority mirrors
    // that set down via `active-chords`; `agent.isBoundChord`) — precise, never blanket, so ⌘W's window-close
    // is suppressed while ⌘C / copy keeps its native default. Its own overlay site answers the modal guard.
    // The disposer is intentionally not captured: this gate is installed once at boot for the surface's
    // whole lifetime, and the listener dies with the window (boot-scope == window-scope). The main window
    // threads its disposer because it installs the gate inside a re-runnable `useEffect`.
    installKeybindGate(window, {
      isFocusedRawTextSurface: () => agent?.isFocusedRawTextSurface() ?? false,
      isBlockingModalOpen: overlaySiteHasBlockingLayer,
      onCandidate: (ks, e) => {
        if (agent?.isBoundChord(ks)) e.preventDefault()
        agent?.forwardKeystroke(ks)
      },
    })

    // THE PER-WINDOW DOM-FOCUS TRACKER (the surface twin of the main window's `installFocusTracker`). DOM
    // focus is the host's single focus source, per window: on `focusin`, resolve the focused pane `^:` and
    // report it UP (the authority feeds its ONE aggregate recency, so focus-MRU spans windows). Focus landing
    // OUTSIDE any pane (chrome / a dialog / the body) resolves to nothing → no report. Plus the OS-focus gate
    // this window's focus/blur toggles whether its ring shows — a blur clears it, a refocus re-rings.
    // Boot-scoped, dies with the window (like the keybind gate above).
    window.addEventListener('focusin', () => {
      const paneId = paneIdOfActiveElement()
      if (paneId !== undefined) agent?.reportFocusFromDom(paneId)
    })
    window.addEventListener('focus', () => agent?.setOsFocused(true))
    window.addEventListener('blur', () => agent?.setOsFocused(false))

    // The one host-owned drag overlay for THIS surface (each renderer is its own window with its own
    // container-core store; drag is same-window), mirroring App.tsx.
    const overlayHost = document.createElement('div')
    document.body.appendChild(overlayHost)
    createRoot(overlayHost).render(<DragOverlay />)
  } catch (err) {
    status(`failed to boot: ${err instanceof Error ? err.message : String(err)}`)
  }
}

status('waiting for the host…')
const disposeInit = window.main.surface.onInit((init) => {
  disposeInit()
  void boot(init)
})
window.main.surface.ready()
