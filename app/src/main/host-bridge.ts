// The agent-host transport SERVER (main process).
//
// au-host serves a local socket au-mcp's host-relay tools connect to and relay
// an agent's live-UI command over. This is the SERVER half; au-host-sdk owns the
// protocol (`@arsumbris/au-host-sdk` transport types), au-mcp owns the client.
//
// The socket lives OUTSIDE the entry tree, in the host's device tenant
// `$HOME/.arsumbris/au-host/run/`, for the same reason the engine keeps its socket out
// of tree: a deep workspace path would overrun the Unix-socket `sun_path` ~104-byte
// limit. The file name reuses engine-sdk's
// `socketFileName` (an identical FNV-1a-64 of the canonical workspace entry, so au-mcp
// derives it from the workspace path it already knows) with a `.host.sock` suffix that
// distinguishes it from the sibling `<hash>.instance.sock` in the same tenant dir.
//
// Framing is engine-sdk's `encodeFrame` / `FrameDecoder`, reused verbatim: one
// JSON message per 4-byte-length-prefixed frame. A request carries a correlation
// id the response echoes, so many commands multiplex one connection.
//
// The SERVER does not execute commands itself — the live surfaces are in the
// RENDERER. It decodes each command and hands it to an injected async handler,
// then frames the result back. The handler relays commands to the renderer.


import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

import { encodeFrame, FrameDecoder, socketFileName } from '@arsumbris/au-engine-sdk'
import type { HostCommand, HostRequestFrame, HostResponseFrame, HostResult } from '@arsumbris/au-host-sdk'

import { hostRunDir } from './device-paths'

/** Executes a decoded command against the live host surfaces through an injected async handler. */
export type CommandHandler = (command: HostCommand) => Promise<HostResult>

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Validate decoded `HostCommand` requests before they reach the renderer executor.
 * The socket is unauthenticated: reject unknown discriminants and missing required payload fields.
 * The validator mirrors the SDK's command union; bodies remain host-opaque.
 */
function isHostCommand(value: unknown): value is HostCommand {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { command?: unknown; intent?: unknown; op?: unknown }
  switch (v.command) {
    case 'introspect':
      return true
    case 'fireIntent':
      return typeof v.intent === 'object' && v.intent !== null
    case 'containerOp':
      return typeof v.op === 'object' && v.op !== null
    default:
      return false
  }
}

/**
 * The host's socket path for a workspace entry: `$HOME/.arsumbris/au-host/run/<hash>.host.sock`.
 * Uses the same canonicalize-then-hash as engine-sdk's `socketPath` (so both ends hash an identical
 * string), under the host's own device tenant, with a `.host.sock` suffix distinguishing it from the
 * sibling `.instance.sock` in the same dir. `entry` is the folder-repo the workspace is rooted at
 * (always a DIRECTORY); it is canonicalized (realpath) before hashing. Exported so a probe / the
 * client side can derive the same path.
 *
 * One folder is one identity, so the hash is injective per workspace.
 */
export function hostSocketPath(entry: string): string {
  const canonical = fs.realpathSync(entry)
  // `socketFileName` yields `<hash>.sock`; swap the suffix for the host socket.
  const fileName = socketFileName(canonical).replace(/\.sock$/, '.host.sock')
  return path.join(hostRunDir(), fileName)
}

/**
 * A single-workspace socket server. One host serves one workspace's socket; a
 * secondary surface is not a second server. Start binds the socket (unlinking a
 * stale file left by a crash); stop closes it and unlinks. Idempotent-ish: a
 * second `start` for a different entry rebinds; `stop` is safe to call twice.
 */
export class HostBridge {
  private server: net.Server | null = null
  private socketFile: string | null = null
  private readonly handler: CommandHandler
  // Every LIVE connection. `server.close()` only stops ACCEPTING — it leaves established
  // sockets open, and the handler resolves `mainWindow` at call time, so a client that
  // connected under workspace A would keep executing commands against workspace B after a
  // switch. Tracked so `stop()` can destroy them.
  private readonly sockets = new Set<net.Socket>()

  constructor(handler: CommandHandler) {
    this.handler = handler
  }

  /** The socket file this bridge is currently bound to, or null. */
  get boundSocket(): string | null {
    return this.socketFile
  }

  /**
   * Bind the socket for a workspace entry and start accepting connections. Resolves
   * once listening. Replaces any prior binding. Creates the sockets dir and unlinks a
   * stale socket file before binding (EADDRINUSE from a leftover file is recovered once).
   */
  async start(entry: string): Promise<void> {
    this.stop()
    const socketFile = hostSocketPath(entry)
    const socketDir = path.dirname(socketFile)
    // 0700 on the DIRECTORY is what actually keeps other local users out, and it is what the
    // engine already sets on this same shared dir (`au-cli/src/daemon.rs`). Set it here too
    // rather than relying on the engine having run first: `mkdirSync` alone is masked by umask
    // (022 yields 0755), and its `mode` does nothing at all when the dir already exists.
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketDir, 0o700)
      } catch (err) {
        // Shared infrastructure the engine also manages — warn, do not refuse to start. The
        // per-socket 0600 below is the guarantee that must hold, and it fails closed.
        console.warn(`[host-bridge] could not chmod 0700 ${socketDir}: ${message(err)}`)
      }
    }
    // A prior crash can leave the socket file; unlink so bind does not EADDRINUSE.
    try {
      fs.unlinkSync(socketFile)
    } catch {
      // Not there — the normal case.
    }

    const server = net.createServer((socket) => this.onConnection(socket))

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

    // ADOPT the server + socket path only AFTER `listen` SUCCEEDS. If it rejected (EADDRINUSE from a
    // LIVE socket — another host instance over this entry), `this.server` / `this.socketFile` stay null, so a
    // later `stop()` cannot `close()` a dead server nor `unlinkSync` a path that is another live instance's
    // socket.
    this.server = server
    this.socketFile = socketFile

    // 0600 the socket itself. `listen` creates it under the umask (0755 by default), and this
    // socket is an unauthenticated command channel into the live UI — every connection is
    // accepted, with no credential or peer check. FAIL CLOSED: if the mode cannot be set we
    // tear the socket down rather than serve a world-writable one. Skipped on win32, where
    // this path is a named pipe with no POSIX mode. There is a brief window between bind and
    // chmod; the 0700 directory above covers it.
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketFile, 0o600)
      } catch (err) {
        this.stop()
        throw new Error(`refusing to serve an unsecured host socket at ${socketFile}: ${message(err)}`)
      }
    }
  }

  /** Close the server, DESTROY every live connection, and unlink the socket file. Safe to
   *  call when not started. Destroying is not optional: `server.close()` stops accepting but
   *  leaves established sockets open, and the command handler resolves the target window at
   *  CALL time — so a client still attached across a workspace switch would go on executing
   *  against the new workspace. */
  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (this.socketFile) {
      try {
        fs.unlinkSync(this.socketFile)
      } catch {
        // Already gone.
      }
      this.socketFile = null
    }
  }

  /** Decode a client's frames, run each command through the handler, frame the reply back. */
  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    const decoder = new FrameDecoder()
    socket.on('data', (chunk: Buffer) => {
      let frames: unknown[]
      try {
        frames = decoder.push(chunk)
      } catch {
        // A desynced / oversized frame is unrecoverable — drop the connection.
        socket.destroy()
        return
      }
      for (const value of frames) void this.dispatch(socket, value)
    })
    // A client hangup / reset is normal; swallow so it never crashes main.
    socket.on('error', () => {})
  }

  /** Run one decoded request frame through the handler and write its response frame. */
  private async dispatch(socket: net.Socket, value: unknown): Promise<void> {
    const frame = value as Partial<HostRequestFrame>
    // A malformed frame with no numeric id cannot be correlated; drop it silently.
    if (typeof frame?.id !== 'number') {
      return
    }
    const id = frame.id
    // VALIDATE the command at the trust boundary — the frame arrived over an unauthenticated socket.
    // An object-shaped but malformed / unknown request must NOT reach the renderer executor relying on it to
    // tolerate garbage. The id is valid, so the client is owed an
    // error frame rather than a silent drop. `isHostCommand` narrows the type.
    if (!isHostCommand(frame.request)) {
      const verb = frame.request && typeof frame.request === 'object' ? (frame.request as { command?: unknown }).command : frame.request
      if (!socket.destroyed) socket.write(encodeFrame({ id, ok: false, error: `unknown host command: ${String(verb)}` }))
      return
    }
    let response: HostResponseFrame
    try {
      const result = await this.handler(frame.request)
      response = { id, ok: true, result }
    } catch (err) {
      response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (!socket.destroyed) socket.write(encodeFrame(response))
  }
}
