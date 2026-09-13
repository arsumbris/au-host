// The per-entry INSTANCE PRESENCE channel: one socket per open workspace that answers a `focus`
// request by raising this instance's window, plus the client side `windows.open` uses to focus an
// existing instance or spawn a new one.

// A workspace is one host instance: one OS process, one engine daemon, one main window. A DIFFERENT
// workspace opens its OWN instance rather than a second window of this one. Opening a workspace that
// is already open focuses that instance instead of duplicating it.

// The socket sits beside the agent-host socket (`<hash>.host.sock`) in the host's device tenant
// `~/.arsumbris/au-host/run/` — two host sockets, distinct suffixes, one hasher (shared with the
// engine socket, which lives in its own `au-engine/run/` tenant). It is app-to-app only: it carries
// no agent-reachable command, and focus is a main-process action with no
// renderer involvement, which is why it is a distinct channel from the agent-host transport.



import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

import { app } from 'electron'

import { socketFileName } from '@arsumbris/au-engine-sdk'

import { hostRunDir } from './device-paths'

/**
 * This instance's presence-socket path for a workspace entry:
 * `$HOME/.arsumbris/au-host/run/<hash>.instance.sock`. Same canonicalize-then-hash as the engine and
 * agent-host sockets (`socketFileName`), with a distinct suffix so the host tenant's two sockets never
 * collide. One folder is one identity, so the hash is injective per workspace. Exported so a probe can
 * derive it.
 */
export function instanceSocketPath(entry: string): string {
  const canonical = fs.realpathSync(entry)
  const fileName = socketFileName(canonical).replace(/\.sock$/, '.instance.sock')
  return path.join(hostRunDir(), fileName)
}

/** The one request the presence socket answers. */
const FOCUS = 'focus'

/**
 * The presence server for the currently-open workspace. Bound while a workspace is open, so a live
 * socket at an entry's path MEANS an instance is serving that workspace. A crashed process leaves a
 * stale socket file, which refuses connections, so liveness is self-cleaning.
 */
export class InstancePresence {
  private server: net.Server | null = null
  private socketFile: string | null = null
  private readonly onFocus: () => void

  constructor(onFocus: () => void) {
    this.onFocus = onFocus
  }

  /** The socket file this presence is currently bound to, or null. */
  get boundSocket(): string | null {
    return this.socketFile
  }

  /**
   * Bind the presence socket for a workspace entry. Replaces any prior binding, and unlinks a stale
   * file a crash left behind so `bind` does not EADDRINUSE.
   */
  async bind(entry: string): Promise<void> {
    this.unbind()
    const socketFile = instanceSocketPath(entry)
    const socketDir = path.dirname(socketFile)
    // 0700 on the shared dir keeps other local users out; the engine sets the same. mkdir's mode is
    // umask-masked and a no-op on an existing dir, so chmod explicitly.
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketDir, 0o700)
      } catch {
        // Shared infrastructure the engine also manages — the 0600 socket below is the guarantee.
      }
    }
    try {
      fs.unlinkSync(socketFile)
    } catch {
      // Not there — the normal case.
    }

    const server = net.createServer((socket) => {
      socket.on('error', () => {}) // a client hangup is normal; never crash main
      socket.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes(FOCUS)) this.onFocus()
      })
    })
    this.server = server
    this.socketFile = socketFile

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(socketFile)
    })

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketFile, 0o600)
      } catch {
        // Best-effort on a same-user app-to-app channel; the 0700 directory covers the window.
      }
    }
  }

  /** Close the server and unlink the socket. Safe to call when not bound. */
  unbind(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (this.socketFile) {
      try {
        fs.unlinkSync(this.socketFile)
      } catch {
        // Already gone.
      }
      this.socketFile = null
    }
  }
}

/** How long to wait for a presence socket to answer before treating the workspace as not-open. A
 *  local unix socket answers or refuses immediately; this only guards a pathological hang. */
const FOCUS_TIMEOUT_MS = 2000

/**
 * Try to focus a running instance serving `entry`. Connects to its presence socket and asks it to
 * raise its window. Resolves true if a live instance answered, false if none is serving — a refused
 * or absent socket, an unresolvable entry, or a hang past the timeout.
 */
export function focusExistingInstance(entry: string): Promise<boolean> {
  let socketFile: string
  try {
    socketFile = instanceSocketPath(entry)
  } catch {
    return Promise.resolve(false) // the entry does not resolve — nothing to focus
  }
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(socketFile)
    let settled = false
    const settle = (live: boolean): void => {
      if (settled) return
      settled = true
      resolve(live)
    }
    socket.setTimeout(FOCUS_TIMEOUT_MS)
    socket.on('connect', () => {
      // `end` writes the focus request then closes cleanly, so the byte is flushed before the FIN.
      socket.end(FOCUS)
      settle(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      settle(false)
    })
    socket.on('error', () => {
      // ECONNREFUSED / ENOENT — no live instance is serving this entry.
      socket.destroy()
      settle(false)
    })
  })
}

/**
 * Spawn a new, independent host instance: the same app binary launched again as its own process,
 * with its own daemon. `entry` boots it straight to that workspace via `AU_ENTRY`; `null` boots it
 * to the startup gate (the new-workspace flow). Detached and unref'd so the child outlives this
 * process.
 */
export function spawnInstance(entry: string | null): void {
  const env = { ...process.env }
  if (entry) env['AU_ENTRY'] = entry
  else delete env['AU_ENTRY']
  // Packaged: `process.execPath` IS the app, launch it with no args. Dev: it is the Electron binary,
  // so point it at the app directory.
  const args = app.isPackaged ? [] : [app.getAppPath()]
  const child = spawn(process.execPath, args, { env, detached: true, stdio: 'ignore' })
  child.unref()
}
