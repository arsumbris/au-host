// Host-owned pty session manager (main process). The pty backend for the terminal
// projection: a projection is renderer-only and can't spawn a pty, so the host owns
// it and exposes it as `host.terminal`.


// SESSION LIFETIME is host-owned and keyed per-pane (compositionId + stable nodeId),
// like the view-store. A remount / layout reshuffle DETACHES + REATTACHES to the SAME
// live session — it never kills it (hard invariant). Output is buffered and replayed
// to a (re)attaching consumer so the screen survives a remount. A session dies only on
// pane removal (reconcile), explicit close, process exit, or app quit.

import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { promisify } from 'node:util'

import type { WebContents } from 'electron'
import type { TerminalAttachOptions } from '@arsumbris/au-host-sdk'
import * as pty from 'node-pty'
import { terminalLaunch } from './terminal-launch'
import { processSnapshot, terminalDescendants, waitForTerminalProcesses, type ProcessIdentity } from './terminal-drain'

const execFileP = promisify(execFile)

/** Read a process's current working directory by pid — shell-agnostic (a pty emits no
 *  cwd events). Linux: /proc; macOS: lsof. Returns undefined if it can't be determined. */
async function pidCwd(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === 'linux') {
      return await fs.promises.readlink(`/proc/${pid}/cwd`)
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileP('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
      // -Fn output: lines `p<pid>` / `fcwd` / `n<path>` — the `n` line is the cwd.
      const line = stdout.split('\n').find((l) => l.startsWith('n'))
      return line ? line.slice(1) : undefined
    }
  } catch {
    // lsof missing / process gone — no cwd
  }
  return undefined
}

// Scrollback replayed to a reattaching consumer. The live stream is unaffected; only
// the replayed history is capped (oldest trimmed).
const MAX_BUFFER = 200_000

interface Session {
  proc: pty.IPty
  disposePrompt: () => void
  buffer: string
  // token -> the renderer that wants this session's live output. Many can listen (the
  // same pane re-mounted mints a new token); detach removes one, kill ends the pty.
  subscribers: Map<number, WebContents>
}

/** A session key is the (composition, node) pair. JSON-encoded so neither component's
 *  contents can collide with a separator. */
function sessionKey(comp: string, node: string): string {
  return JSON.stringify([comp, node])
}

export class TerminalSessions {
  private sessions = new Map<string, Session>()

  private drainingOwners: ProcessIdentity[] = []
  private closing = false

  /** App shutdown only: keep lifecycle services alive until owned children have exited. */
  async drain(): Promise<boolean> {
    if (!this.sessions.size && !this.drainingOwners.length) return true
    this.closing = true
    try {
      const snapshot = await processSnapshot()
      this.drainingOwners.push(...terminalDescendants(snapshot, [...this.sessions.values()].map(session => session.proc.pid)))
      this.killAll()
      const drained = await waitForTerminalProcesses(this.drainingOwners)
      if (drained) this.drainingOwners = []
      return drained
    } finally { this.closing = false }
  }

  /** Attach a consumer (token+sender) to this pane's session, spawning the pty if none
   *  exists. Replays the buffered scrollback to the new consumer, then it streams live. */
  attach(
    comp: string,
    node: string,
    token: number,
    sender: WebContents,
    opts: TerminalAttachOptions,
  ): void {
    const key = sessionKey(comp, node)
    let session = this.sessions.get(key)
    if (!session) {
      if (this.closing) {
        if (!sender.isDestroyed()) sender.send('terminal:exit', { token })
        return
      }
      const shell =
        opts.shell || process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
      const spawnCwd = opts.cwd || os.homedir()
      let startup: ReturnType<typeof terminalLaunch> | undefined
      let proc: pty.IPty
      try {
        startup = terminalLaunch(shell, opts.prompt, opts.command)
        proc = pty.spawn(shell, startup.args, {
          name: 'xterm-256color',
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 24,
          cwd: spawnCwd,
          env: startup.env as { [key: string]: string },
        })
      } catch (err) {
        startup?.dispose()
        // A failed spawn (bad cwd, missing shell, native-module mismatch) must NOT stay silent:
        // the renderer fires attach fire-and-forget, so a swallowed throw leaves a blank pane with
        // nothing in the renderer console. Surface it into the xterm + the main log instead.
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[terminal] pty.spawn failed (shell=${shell}, cwd=${spawnCwd}):`, err)
        if (!sender.isDestroyed()) {
          sender.send('terminal:data', {
            token,
            data: `\r\n\x1b[31m[failed to start shell "${shell}" in ${spawnCwd}: ${msg}]\x1b[0m\r\n`,
          })
          sender.send('terminal:exit', { token })
        }
        return
      }
      const s: Session = { proc, disposePrompt: startup.dispose, buffer: '', subscribers: new Map() }
      proc.onData((data) => {
        s.buffer += data
        if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-MAX_BUFFER)
        for (const [tok, sn] of s.subscribers) {
          if (!sn.isDestroyed()) sn.send('terminal:data', { token: tok, data })
        }
      })
      proc.onExit(() => this.kill(comp, node))
      session = s
      this.sessions.set(key, s)
    }
    session.subscribers.set(token, sender)
    // Replay the scrollback so the (re)mounted xterm reconstructs the screen.
    if (session.buffer && !sender.isDestroyed()) sender.send('terminal:data', { token, data: session.buffer })
  }

  /** A consumer stopped listening (its view unmounted). Does NOT kill the session — the
   *  pane may be re-mounting (reshuffle). The session lives until removed/closed/exited. */
  detach(comp: string, node: string, token: number): void {
    this.sessions.get(sessionKey(comp, node))?.subscribers.delete(token)
  }

  write(comp: string, node: string, data: string): void {
    this.sessions.get(sessionKey(comp, node))?.proc.write(data)
  }

  resize(comp: string, node: string, cols: number, rows: number): void {
    try {
      this.sessions.get(sessionKey(comp, node))?.proc.resize(cols, rows)
    } catch {
      // a dead pty rejects resize — harmless
    }
  }

  /** The shell's current working directory (queried from its pid). undefined if no
   *  session or it can't be read. The renderer polls this to persist the live cwd. */
  async cwd(comp: string, node: string): Promise<string | undefined> {
    const session = this.sessions.get(sessionKey(comp, node))
    if (!session) return undefined
    return pidCwd(session.proc.pid)
  }

  /** Terminate a session: kill the pty, drop it, tell its subscribers it exited. */
  kill(comp: string, node: string): void {
    const key = sessionKey(comp, node)
    const session = this.sessions.get(key)
    if (!session) return
    this.sessions.delete(key)
    session.disposePrompt()
    for (const [tok, sn] of session.subscribers) {
      if (!sn.isDestroyed()) sn.send('terminal:exit', { token: tok })
    }
    try {
      session.proc.kill()
    } catch {
      // already dead
    }
  }

  /** Kill sessions for `comp` whose node has left the LIVE layout (the pane was closed).
   *  A reshuffle keeps the node in the live tree (an atomic move), so it is NOT killed —
   *  that is the reshuffle-safe invariant. Driven by the renderer on every working-tree
   *  update with the current node-id set. */
  reconcile(comp: string, liveNodeIds: string[]): void {
    const live = new Set(liveNodeIds)
    for (const key of [...this.sessions.keys()]) {
      const [c, node] = JSON.parse(key) as [string, string]
      if (c === comp && !live.has(node)) this.kill(c, node)
    }
  }

  /** A renderer was destroyed: drop it from every session's subscriber map so its dead
   *  WebContents isn't retained (a window closed without detaching). Sessions themselves
   *  persist for remount/reattach; pane removal still reaps them via reconcile/kill. */
  purgeSender(senderId: number): void {
    for (const session of this.sessions.values()) {
      for (const [token, sn] of session.subscribers) {
        if (sn.id === senderId || sn.isDestroyed()) session.subscribers.delete(token)
      }
    }
  }

  /** Kill every session — on app quit (the pty children die with the host anyway, this
   *  is the clean shutdown). */
  killAll(): void {
    for (const session of this.sessions.values()) {
      session.disposePrompt()
      try {
        session.proc.kill()
      } catch {
        // already dead
      }
    }
    this.sessions.clear()
  }
}
