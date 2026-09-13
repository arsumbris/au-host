// The two concrete SurfaceTransport implementations.
//
// ONE model, two transports: the authority drives every surface through the same
// SurfaceTransport seam, so its drive code never branches on which window a record renders in — only
// the transport differs. These touch `window.main`, so they live apart from the pure seam + guard in
// `surface-protocol.ts` (which stays probe-clean, no renderer globals).

import type { SurfaceCommand, SurfaceEvent } from '../../../shared/daemon-api'
import type { SurfaceTransport } from './surface-protocol'

/**
 * The IPC transport: the authority drives a SECONDARY surface across the process boundary via
 * `window.main.surface`. Bound to one surface id; the global event stream is tagged with a surface id,
 * so this filters it to its own. `dispose` drops its listeners and closes the surface's window (a no-op
 * if the user already closed it — main guards a gone window).
 */
export class IpcSurfaceTransport implements SurfaceTransport {
  private readonly disposers: (() => void)[] = []

  constructor(private readonly surfaceId: string) {}

  sendCommand(command: SurfaceCommand): void {
    window.main.surface.sendCommand(this.surfaceId, command)
  }

  onEvent(listener: (event: SurfaceEvent) => void): () => void {
    const dispose = window.main.surface.onEvent((sid, event) => {
      if (sid === this.surfaceId) listener(event)
    })
    this.disposers.push(dispose)
    return () => {
      dispose()
      const i = this.disposers.indexOf(dispose)
      if (i >= 0) this.disposers.splice(i, 1)
    }
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d()
    void window.main.surface.close(this.surfaceId)
  }
}

/**
 * In-process transport for a surface co-located with the authority. Commands and events use local
 * calls without serialization or IPC, through the same `SurfaceTransport` interface as remote surfaces.
 */
export class InProcessSurfaceTransport implements SurfaceTransport {
  // Maintain a listener set, matching `IpcSurfaceTransport`: notify every subscriber and remove only
  // the listener whose disposer runs.
  private readonly listeners = new Set<(event: SurfaceEvent) => void>()

  /** `onCommand` is the co-located agent's command executor (called synchronously — no IPC). */
  constructor(private readonly onCommand: (command: SurfaceCommand) => void) {}

  sendCommand(command: SurfaceCommand): void {
    this.onCommand(command)
  }

  onEvent(listener: (event: SurfaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The co-located agent reports an event; delivered locally to the authority's subscriber(s). */
  deliver(event: SurfaceEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  dispose(): void {
    this.listeners.clear()
  }
}
