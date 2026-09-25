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
 * The WORKSPACE CLAIM: the presence server for the workspace this instance serves. Held while the
 * workspace is open, so a live socket at an entry's path MEANS an instance holds that workspace, and it is
 * the only process that writes the workspace's local stores. A crashed process leaves a stale socket file,
 * which refuses connections, so a claim over it succeeds.
 */
export class InstancePresence {
  private server: net.Server | null = null
  private socketFile: string | null = null
  /** Every claim runs after the one before it, so two claims never race each other's socket. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly onFocus: () => void

  constructor(onFocus: () => void) {
    this.onFocus = onFocus
  }

  /** The socket file this presence is currently bound to, or null. */
  get boundSocket(): string | null {
    return this.socketFile
  }

  /**
   * CLAIM a workspace entry: become the one instance serving it. Resolves true when this instance now
   * holds the claim, false when another LIVE instance holds it (that instance has been asked to focus).
   * Rejects when the claim could not be decided (the socket is unusable, or its holder does not answer).
   *
   * A switch is ACQUIRE-THEN-RELEASE: the new entry is bound first, then `handover` runs while BOTH are
   * still held (the caller finishes its writes to the old workspace there), and only then is the old
   * claim given up. A failed switch runs no handover and leaves the old claim, and everything bound to
   * it, exactly as it was.
   *
   * Listen first; only on EADDRINUSE probe the existing socket. A live holder answers → the claim fails and
   * the holder is focused. A socket that refuses the connect is stale (its process is gone) → unlink it and
   * listen. A live socket is never unlinked, so a second instance can never silently take over a workspace.
   */
  claim(entry: string, handover?: () => void): Promise<boolean> {
    const result = this.queue.then(() => this.claimAt(entry, handover))
    this.queue = result.catch(() => {})
    return result
  }

  private async claimAt(entry: string, handover?: () => void): Promise<boolean> {
    const socketFile = instanceSocketPath(entry)
    if (this.server && this.socketFile === socketFile) return true
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
    let server: net.Server
    try {
      server = await this.listen(socketFile)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      const holder = await probeInstance(socketFile, true)
      if (holder === 'live') return false // a live instance holds it, and now has focus
      if (holder === 'unresponsive') {
        throw new Error('another instance holds this workspace but did not answer; close it, then try again')
      }
      try {
        fs.unlinkSync(socketFile) // stale: its process is gone
      } catch {
        // Already gone.
      }
      server = await this.listen(socketFile)
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketFile, 0o600)
      } catch {
        // Best-effort on a same-user app-to-app channel; the 0700 directory covers the window.
      }
    }
    // The new claim is held. The caller finishes with the previous workspace, and only then is it given up.
    if (this.server) {
      try {
        handover?.()
      } catch (err) {
        console.error('[instance-presence] handover threw', err)
      }
    }
    this.release()
    this.server = server
    this.socketFile = socketFile
    return true
  }

  private listen(socketFile: string): Promise<net.Server> {
    const server = net.createServer((socket) => {
      socket.on('error', () => {}) // a client hangup is normal; never crash main
      socket.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes(FOCUS)) this.onFocus()
      })
    })
    return new Promise<net.Server>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off('error', onError)
        // A server error after listening (e.g. out of descriptors on accept) must not become an uncaught
        // exception in main; the claim stays held, a new focus request simply retries the accept.
        server.on('error', (err) => console.error('[instance-presence] claim socket error', err))
        resolve(server)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(socketFile)
    })
  }

  /** Give up the claim: close the server and unlink the socket. Safe to call when not holding one. */
  release(): void {
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

/** How long to wait for a presence socket to answer. A local unix socket answers or refuses at once;
 *  this only bounds a holder that is alive but hung. */
const FOCUS_TIMEOUT_MS = 2000

/**
 * What answers at a presence socket:
 * - `live` — an instance accepted the connection (and, when asked, was told to focus).
 * - `absent` — nothing is listening: the file is missing or refuses the connect. Only this proves a
 *   socket file stale.
 * - `unresponsive` — the connect neither completed nor was refused in time. Something may still hold it,
 *   so it is never treated as stale.
 */
export type InstanceProbe = 'live' | 'absent' | 'unresponsive'

function probeInstance(socketFile: string, focus: boolean): Promise<InstanceProbe> {
  return new Promise<InstanceProbe>((resolve) => {
    const socket = net.connect(socketFile)
    let settled = false
    const settle = (outcome: InstanceProbe): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    socket.setTimeout(FOCUS_TIMEOUT_MS)
    socket.on('connect', () => {
      // `end` writes the focus request then closes cleanly, so the byte is flushed before the FIN.
      if (focus) socket.end(FOCUS)
      else socket.end()
      settle('live')
    })
    socket.on('timeout', () => {
      socket.destroy()
      settle('unresponsive')
    })
    socket.on('error', () => {
      // ECONNREFUSED / ENOENT — nothing is serving this socket.
      socket.destroy()
      settle('absent')
    })
  })
}

/**
 * Try to focus a running instance serving `entry`. Resolves true if a live instance answered, false
 * otherwise: nothing is serving it, the entry does not resolve, or its holder did not answer in time.
 */
export async function focusExistingInstance(entry: string): Promise<boolean> {
  let socketFile: string
  try {
    socketFile = instanceSocketPath(entry)
  } catch {
    return false // the entry does not resolve — nothing to focus
  }
  return (await probeInstance(socketFile, true)) === 'live'
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
