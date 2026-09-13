// Main-process transport for the mount / proxy command protocol.
//
// A SURFACE is a secondary window the AUTHORITY (the main renderer's CompositionRuntime) drives. A
// surface is keyed by its WINDOW-NODE POOL ID — a stable `^:` from the composition pool — so a reload /
// reconnect re-attaches to the same window node. Main is a pure IPC broker: it opens the window, relays
// SurfaceCommands DOWN to it and SurfaceEvents UP to the opener, each tagged with the surface id
// (derived from the sender, never trusted from the renderer). It owns no protocol logic — the
// generation guard + mount decisions live in the renderers.

import * as path from 'node:path'

import { BrowserWindow } from 'electron'
import { macFrameOptions, reassertTrafficLights } from './window-frame'

import type { SurfaceCommand, SurfaceEvent, SurfaceInit, SurfaceOpenRequest } from '../shared/daemon-api'

interface SurfaceWindow {
  win: BrowserWindow
  init: SurfaceInit
  /** The authority renderer's webContents that opened this surface (gets onReady / onClosed / onEvent). */
  opener: Electron.WebContents
  /**
   * Set true just before an AUTHORITY-driven `win.close()` (a dock / move / confirmed-close teardown, or an
   *  opener-gone orphan sweep). The preventable `close` handler lets such a close proceed; a USER close (the
   *  traffic-light / cmd-W), where this is false, is PREVENTED and routed to the authority to confirm.
   */
  programmaticClose?: boolean
}

export class SurfaceWindows {
  /** Surface identity is the window-node POOL ID (a `^:`), never an integer. */
  private readonly bySurfaceId = new Map<string, SurfaceWindow>()
  /** Reverse index: a surface renderer's webContents id → its surface id, so the ready handshake and an
   *  event report find the right surface without trusting a renderer-supplied id. */
  private readonly surfaceIdByWebContents = new Map<number, string>()
  /** A surface's mount agent signalled ready → tell its opener so the authority starts driving it. */
  onReady?: (surfaceId: string, opener: Electron.WebContents) => void
  /** A surface window closed (user or programmatic) → tell its opener so it re-derives (dormant). */
  onClosed?: (surfaceId: string, opener: Electron.WebContents) => void
  /** A surface's RENDERER crashed / was force-killed (`render-process-gone`, NOT a clean close) → tell its
   *  opener so the authority offers to reopen it. Fires before the `onClosed` the window teardown triggers. */
  onCrashed?: (surfaceId: string, opener: Electron.WebContents) => void
  /**
   * The USER asked to close a surface window (traffic-light / cmd-W) → the close is PREVENTED and the
   *  authority is asked what to do (empty: close+reap; non-empty: prompt IN the window). NOT fired for a
   *  programmatic close (dock / move / confirmed-close / opener-gone / quit) — those proceed.
   */
  onCloseRequested?: (surfaceId: string, opener: Electron.WebContents) => void

  /** Open a surface window for a window-node pool id. Idempotent: an already-open surface id focuses its
   *  existing window rather than spawning a second (a re-open of the same window node). */
  open(req: SurfaceOpenRequest, opener: Electron.WebContents): void {
    const existing = this.bySurfaceId.get(req.surfaceId)
    if (existing && !existing.win.isDestroyed()) {
      if (existing.win.isMinimized()) existing.win.restore()
      existing.win.focus()
      return
    }
    const b = req.options?.bounds
    const win = new BrowserWindow({
      width: b?.width ?? 800,
      height: b?.height ?? 600,
      x: b?.x,
      y: b?.y,
      title: req.options?.title ?? req.surfaceId,
      backgroundColor: '#000000',
      // Frame identically to the main window: on macOS, hidden title bar + traffic lights in the
      // shell's reserved gap, so a floated window is not a bespoke native-framed masthead but the same shell.
      ...macFrameOptions(),
      // E2E: create the floated window hidden so a run never covers the screen (mirrors the main window;
      // Chromium still renders and Playwright drives it over CDP via `electronApp.waitForEvent('window')`).
      ...(process.env.AU_E2E_OFFSCREEN ? { show: false } : {}),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    reassertTrafficLights(win)
    // Capture the webContents id now: after `closed` the window is destroyed and touching
    // `win.webContents` throws "Object has been destroyed".
    const wcId = win.webContents.id
    const init: SurfaceInit = { entryPath: req.entryPath, surfaceId: req.surfaceId, compositionId: req.compositionId, title: req.options?.title, viewerDefaults: req.viewerDefaults, slotDefaults: req.slotDefaults }
    this.bySurfaceId.set(req.surfaceId, { win, init, opener })
    this.surfaceIdByWebContents.set(wcId, req.surfaceId)

    // A surface belongs to its opener's composition (the authority). If the opener goes away, close the
    // orphan too — otherwise it lingers and tries to notify a destroyed opener on a later manual close. A
    // programmatic close (the opener is gone, so there is nobody to prompt).
    const onOpenerGone = (): void => {
      const entry = this.bySurfaceId.get(req.surfaceId)
      if (entry) entry.programmaticClose = true
      if (!win.isDestroyed()) win.close()
    }
    opener.once('destroyed', onOpenerGone)

    // INTERCEPT the USER close (traffic-light / cmd-W): PREVENT it and ask the authority. It decides —
    // an empty window closes+reaps directly, a non-empty one prompts IN this window — and drives the actual
    // close back through `close()` (which sets `programmaticClose`, so this handler then lets it proceed). A
    // programmatic close (dock / move / confirmed-close / opener-gone) already set the flag and passes
    // through; the crash path uses `win.destroy()`, which bypasses the preventable `close` entirely.
    win.on('close', (e) => {
      const entry = this.bySurfaceId.get(req.surfaceId)
      if (entry?.programmaticClose || opener.isDestroyed()) return // authority-driven / no one to ask → proceed
      e.preventDefault()
      this.onCloseRequested?.(req.surfaceId, opener)
    })

    win.on('closed', () => {
      this.bySurfaceId.delete(req.surfaceId)
      this.surfaceIdByWebContents.delete(wcId)
      if (!opener.isDestroyed()) {
        opener.removeListener('destroyed', onOpenerGone)
        this.onClosed?.(req.surfaceId, opener)
      }
    })

    // A CRASH / force-kill of the surface renderer: the window survives (blank), so
    // signal the opener that THIS surface died UNEXPECTEDLY — distinct from a clean close — then destroy the
    // window (which fires `closed` → the normal `onClosed` cleanup). `reason: 'clean-exit'` is a normal
    // teardown, never a crash. The window-node stays in the authority's pool (dormant); the authority offers
    // to reopen. Guarded so a crash after the opener is gone is a plain teardown.
    win.webContents.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      if (!opener.isDestroyed()) this.onCrashed?.(req.surfaceId, opener)
      if (!win.isDestroyed()) win.destroy()
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/surface.html`)
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/surface.html'))
    }
  }

  /**
   * The surface renderer's mount agent signalled ready. Notify the opener (so the authority starts
   * driving it) and return the surface's init (for the reply to the agent). Undefined if the sender is
   * not a tracked surface.
   */
  handleReady(sender: Electron.WebContents): SurfaceInit | undefined {
    const surfaceId = this.surfaceIdByWebContents.get(sender.id)
    if (surfaceId === undefined) return undefined
    const entry = this.bySurfaceId.get(surfaceId)
    if (!entry) return undefined
    if (!entry.opener.isDestroyed()) this.onReady?.(surfaceId, entry.opener)
    return entry.init
  }

  /**
   * Relay a surface's reported event UP to its opener, tagged with the surface id (derived from the
   * sender, so a surface can't spoof another's). No-op if the surface or its opener is gone.
   */
  relayEvent(sender: Electron.WebContents, event: SurfaceEvent): void {
    const surfaceId = this.surfaceIdByWebContents.get(sender.id)
    if (surfaceId === undefined) return
    const entry = this.bySurfaceId.get(surfaceId)
    if (!entry || entry.opener.isDestroyed()) return
    entry.opener.send('surface:event-to-opener', { surfaceId, event })
  }

  /**
   * Close a surface window by id (the authority's teardown path). Marks the close PROGRAMMATIC so the
   *  preventable `close` handler lets it proceed without re-prompting the user.
   */
  close(surfaceId: string): void {
    const entry = this.bySurfaceId.get(surfaceId)
    if (!entry) return
    entry.programmaticClose = true
    entry.win.close()
  }

  /**
   * Relay a command DOWN to a surface. Guards that `sender` is the surface's OPENER (the authority), so
   * a renderer can't drive a window it did not open. No-op if the surface or its window is gone (the
   * command is dropped — the generation guard would drop a late one anyway).
   */
  sendCommand(sender: Electron.WebContents, surfaceId: string, command: SurfaceCommand): void {
    const entry = this.bySurfaceId.get(surfaceId)
    if (!entry || entry.win.isDestroyed()) return
    if (entry.opener !== sender) return // only the opener may drive its own surfaces.
    entry.win.webContents.send('surface:command', command)
    // Surface the window when content lands in it, so the user sees where the pane went — it may be behind
    // the main window or minimized. A MOUNT/REMOTE-MOUNT (a cross-window open / float) always raises; a
    // routed COMMIT (a cross-window open whose container renders the new tab locally, so no mount command
    // is sent) raises too, carrying its own `raise` flag (set only for a routed intent, never a broadcast).
    // Not for reflect/unmount/claim (in-place updates, teardowns, and pure queries must not steal focus).
    if (command.op === 'mount' || command.op === 'remount' || (command.op === 'commit' && command.raise)) {
      // Never SURFACE a deliberately-hidden window (a `show:false` headless/e2e surface): only bring forward
      // one already on screen or minimized, else focus/restore would un-hide it.
      if (!entry.win.isVisible() && !entry.win.isMinimized()) return
      if (entry.win.isMinimized()) entry.win.restore()
      entry.win.focus()
    }
  }

  /** Tear down all surface windows (app quit). */
  dispose(): void {
    for (const { win } of this.bySurfaceId.values()) if (!win.isDestroyed()) win.destroy()
    this.bySurfaceId.clear()
    this.surfaceIdByWebContents.clear()
  }
}
