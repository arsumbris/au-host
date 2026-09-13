// Renderer half of the host terminal capability: wraps the process-boundary
// `window.main.terminal` into the per-instance `host.terminal` a projection sees.
// The host scopes the session key (composition + this node's stable id); the
// projection just attaches and renders.


import type { TerminalChannel, TerminalSession } from './host-config'

/** Build the per-instance terminal capability. An empty `nodeId` (the composition root,
 *  which has no pty) yields a no-op channel. `compositionId` is read live (the runtime
 *  is stable across composition switches), matching the view-store. */
export function createTerminalChannel(compositionId: () => string, nodeId: string): TerminalChannel {
  if (!nodeId) {
    return {
      attach: (): TerminalSession => ({
        onData: () => () => {},
        onExit: () => () => {},
        write: () => {},
        resize: () => {},
        send: () => {},
        cwd: () => Promise.resolve(undefined),
        detach: () => {},
        close: () => {},
      }),
    }
  }
  return {
    attach(opts) {
      const comp = compositionId()
      let dataListener: ((chunk: string) => void) | null = null
      let exitListener: (() => void) | null = null
      // Output that arrives before the projection registers `onData` (the attach reply's
      // replayed buffer can land first) is queued, then flushed on registration.
      const pending: string[] = []
      const handle = window.main.terminal.attach(
        comp,
        nodeId,
        opts ?? {},
        (chunk) => {
          if (dataListener) dataListener(chunk)
          else pending.push(chunk)
        },
        () => exitListener?.(),
      )
      return {
        onData(listener) {
          dataListener = listener
          if (pending.length) {
            const queued = pending.splice(0)
            for (const chunk of queued) listener(chunk)
          }
          return () => {
            if (dataListener === listener) dataListener = null
          }
        },
        onExit(listener) {
          exitListener = listener
          return () => {
            if (exitListener === listener) exitListener = null
          }
        },
        write: handle.write,
        resize: handle.resize,
        send: handle.send,
        cwd: () => window.main.terminal.cwd(comp, nodeId),
        detach: handle.detach,
        close: handle.close,
      }
    },
  }
}
