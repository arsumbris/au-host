// Track engine readiness through the `ready` lifecycle channel. A connected socket alone does not
// guarantee complete reads while the engine is deriving.
// The main connection's `watchReady` edge gates the subscription and reopens it after reconnect.
// Each ready-channel event triggers an authoritative lifecycle read; use its boolean readiness
// flag rather than parsing state strings. Notify subscribers only when readiness changes.
// A projection's mount-time read handles an already-ready engine; the change edge handles recovery.

import type { EngineReadiness } from './host-config'

export interface EngineReadinessSource extends EngineReadiness {
  dispose(): void
}

/**
 * Watch engine readiness for an entry, surfacing change edges to subscribers.
 *
 * The watch is ref-counted: it runs only while there is at least one subscriber,
 * so it lives with the projections' subscribe/unsubscribe effects, not with this
 * object's construction (which keeps it alive under React StrictMode — a watch
 * opened at construction would be torn down by the dev-mode mount/unmount cycle).
 */
export function createEngineReadiness(entryPath: string): EngineReadinessSource {
  const listeners = new Set<(ready: boolean) => void>()
  let ready = false
  let unwatch: (() => void) | null = null // the socket-`connected` reconnect watch
  let unsubscribe: (() => void) | null = null // the engine `ready` subscription
  let readSeq = 0 // guards against a stale/out-of-order readiness re-query landing

  function setReady(next: boolean): void {
    if (next === ready) return
    ready = next
    for (const listener of listeners) listener(ready)
  }

  // Re-query the authoritative readiness boolean from the `ready` read envelope.
  // The subscription only tells us SOMETHING changed; the envelope's `ready` flag
  // is the source of truth (the same flag the daemon probe uses).
  async function refreshReadyFlag(): Promise<void> {
    const seq = ++readSeq
    try {
      const r = await window.main.engine.read(entryPath, { read: 'lifecycle' })
      if (seq !== readSeq) return // a newer refresh (or a disconnect) superseded this
      setReady(r.ok === true && r.ready === true)
    } catch {
      if (seq === readSeq) setReady(false)
    }
  }

  function openReadySub(): void {
    if (unsubscribe) return
    unsubscribe = window.main.engine.subscribe(entryPath, { subscribe: 'lifecycle' }, (event) => {
      if (event.kind === 'closed') {
        // The socket dropped (or the host tore the subscription down). Readiness
        // is false; the `connected` watch reopens the subscription on reconnect.
        setReady(false)
        return
      }
      // initial-value or lifecycle-changed: re-query the authoritative boolean.
      void refreshReadyFlag()
    })
  }

  function closeReadySub(): void {
    unsubscribe?.()
    unsubscribe = null
    readSeq++ // invalidate any in-flight refresh so it can't land after close
  }

  function start(): void {
    if (unwatch) return
    unwatch = window.main.engine.watchReady(entryPath, (connected) => {
      if (connected) {
        // The socket is up; open the `ready` subscription. Its initial-value
        // event re-queries the boolean, seeding readiness for this connection.
        openReadySub()
      } else {
        closeReadySub()
        setReady(false)
      }
    })
  }

  function stop(): void {
    unwatch?.()
    unwatch = null
    closeReadySub()
    // A fresh watch re-seeds from the current state, so forget the stale value.
    ready = false
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
    dispose() {
      stop()
      listeners.clear()
    },
  }
}
