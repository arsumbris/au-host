import './dev-flag' // MUST be the VERY FIRST import — sets the DEV split-bridge flag (`__AU_DEV__`) before
// ANY shared-dep's eager module-eval reads it. container-kit (below) transitively loads container-core,
// whose `singletons.ts` binds its shared registry EAGERLY at eval: if the flag is unset then, the shell's
// vite copy binds a MODULE-LOCAL registry (bridging=false) split from the served projections' window-global
// one, so a container registered by the shell (the surface root placement) is invisible to a projection's
// registry walk. That broke `dissolvePane`'s grandparent lookup at a floated window root (unwrap dead-ended
// with no-parent-container). Keep this the first statement, as main.tsx does.
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
import { discoverSubstrateFacts, installSubstrateFacts } from './projections/substrate-facts'
import { discoverMembers } from './projections/members'
import { discoverComponentSets, discoverComponents } from './projections/component-discovery'
import { registerComponentSets } from './projections/component-registry'
import { getActiveLook } from './projections/active-set-store'
import { installComponentOverlayChannel, overlaySiteHasBlockingLayer } from './projections/overlay-site'
import { installKeybindGate } from './projections/keybind-gate'
import { installEventReadBridge } from './projections/event-read-bridge'
import { createEngineReadiness } from './projections/engine-readiness'
import { MountAgent } from './projections/mount-agent'
import { createFilesControl } from './projections/mount-host'
import { loadTokenSheets } from './projections/token-sheets'
import { paneIdOfActiveElement } from './projections/pane-focus'
import { WindowRootShell } from './projections/window-root-shell'
import { isMacRenderer } from './projections/platform'
import { applyStoredTheme } from './projections/theme-store'
import type { ContextMenuItem, MountHost } from '@arsumbris/au-host-sdk'
import { discoverContainerCapabilities, installGroupingProvider, installWrapTargets } from './projections/grouping-discovery'
import type { GroupingPolicy, SurfaceCommand, SurfaceInit } from '../../shared/daemon-api'

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
    const [discovery, members, facts] = await Promise.all([discoverProjections(reader), discoverMembers(reader), discoverSubstrateFacts(reader)])
    // The container substrate's TYPE FACTS, installed exactly as the main window installs them: without
    // them a floated container cannot evaluate `admits`, recognize a slot subtype, or tell which slot
    // type a position holds. Installed before anything mounts.
    installSubstrateFacts(discovery.projections, facts)

    // Register the `<au-*>` component set into THIS window's custom-element registry, mirroring the main
    // window's ProjectionHost boot — otherwise a projection's `<au-icon>` / `<au-*>` chrome never upgrades
    // and it renders unstyled. Each renderer has its OWN registry, so a surface must define them itself.
    const [componentSets, componentDefs] = await Promise.all([discoverComponentSets(reader), discoverComponents(reader)])
    const reg = await registerComponentSets(componentSets, componentDefs, getActiveLook())
    for (const d of reg.diagnostics) console.warn(d)

    // The file port for token-sheet loads (below) and the discovery refresh.
    const files = createFilesControl(init.entryPath)

    // Populate THIS window's GROUPING registry from the type graph, mirroring ProjectionHost.
    // Container-core's grouping lookup is a per-renderer module singleton, so without this a floated
    // container's WRAP finds no grouping container (`groupingForNewGroup()` null → `no-grouping`) and the
    // mint over the wire is never reached. The composition-level `group-into` is authority-owned, so a
    // surface installs the discovered capabilities only.
    // The composition's grouping policy (`group-into`, `group-new-panes`) is authority-owned: it arrives in the
    // init and is re-pushed on change. Installed together with this window's own discovered capabilities, so
    // a wrap here picks its container exactly as the main window would.
    let caps = await discoverContainerCapabilities(reader)
    let policy: GroupingPolicy = init.grouping ?? { groupNewPanes: false }
    const installGrouping = (): void => {
      installGroupingProvider(caps.grouping, policy.groupInto, policy.groupNewPanes)
      installWrapTargets(caps, policy.groupInto)
    }
    installGrouping()

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
      // A subwindow root's ⋯ actions are "Wrap in a container" (the twin of the main window's `root.wrap`,
      // proxied to the authority since a surface holds no pool) and "Move to other window" (dock subsumed —
      // its picker includes the main window). A secondary window always has >=2 windows, so both rows are
      // always present.
      const moveRow = info ? moveToWindowRow(info.host, info.id) : null
      const wrapRow: ContextMenuItem = { id: 'root.wrap', label: 'Wrap in a container', icon: 'wrap', enabled: true, run: () => void agent?.wrapRoot() }
      headerRoot.render(
        info ? <WindowRootShell host={info.host} rootLabel={info.label} rootActions={() => [wrapRow, ...(moveRow ? [moveRow] : []), ...reloadPaneRows(info.host, info.id)]} isMac={isMac} zoom={1} /> : null,
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
      (next) => {
        policy = next
        installGrouping()
      },
    )

    // TOKEN SHEETS — eager-load each projection's + component set's `customTokenEntry` declaration sheet at
    // document level, the SAME path the main window runs. Without this a floated window has NONE of the
    // `--au-<projection>-*` / `--au-<component>-*` tokens, so a projection that colors text / strokes lines via
    // its own tokens (focal-tree's `--au-focal-tree-label` / `-edge`, radial-tree, force-graph) renders with
    // unset fill + stroke — the reported "text color broken, lines don't draw" in a popped-out window (wired
    // in the main window, silently absent on the surface). NON-BLOCKING (fire-and-forget), exactly
    // as the main window loads it AFTER its render-gating state: tokens are progressive enhancement (CSS vars
    // resolve live once adopted), so a slow / failed read never gates the surface's content mount.
    void loadTokenSheets([...discovery.projections, ...componentSets], files)
      .then((diags) => { for (const d of diags) console.warn(`[token-sheet] ${d.projection} (${d.path}): ${d.message}`) })
      .catch((e) => console.error('Surface token-sheet load failed:', e))

    const subscriber: TypedSubscriber = { subscribe: (request, listener) => window.main.engine.subscribe(init.entryPath, request, listener) }
    const readiness = createEngineReadiness(init.entryPath)
    let disposed = false
    let detach: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let refreshGeneration = 0
    const refresh = async (): Promise<void> => {
      const generation = ++refreshGeneration
      try {
        const [next, nextCaps, sets, nextFacts] = await Promise.all([
          discoverProjections(reader), discoverContainerCapabilities(reader), discoverComponentSets(reader), discoverSubstrateFacts(reader),
        ])
        if (!disposed && generation === refreshGeneration) {
          installSubstrateFacts(next.projections, nextFacts)
          caps = nextCaps
          installGrouping()
          agent?.updateDiscovery(next.projections)
          // Reload token sheets so a newly-authored projection/set's `--au-*` tokens appear live in this
          // floated window, matching the main window's per-discovery-pass reload. Non-blocking + idempotent.
          void loadTokenSheets([...next.projections, ...sets], files)
            .then((diags) => { for (const d of diags) console.warn(`[token-sheet] ${d.projection} (${d.path}): ${d.message}`) })
            .catch((e) => console.error('Surface token-sheet reload failed:', e))
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
