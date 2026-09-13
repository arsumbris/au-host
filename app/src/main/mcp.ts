// au-mcp daemon supervision (main process).
//
// The second daemon in the agent stack: the engine daemon serves the typed graph,
// the au-mcp daemon brokers it and serves the agent tools over its own hashed socket
// under its device tenant (`~/.arsumbris/au-mcp/run/<hash>.sock`, keyed by the workspace
// entry). The host already supervises the engine daemon (`daemon.ts` via the engine SDK);
// this is the parallel supervisor for au-mcp.
//
// OWNED-CHILD model, deliberately: the host always STARTS the au-mcp daemon (unlike
// the engine daemon, which the user may point at an already-running one). So liveness
// is "our child is alive + it announced it is listening", and stop is a graceful
// SIGTERM (the CLI's signal handler stops the server and unlinks the socket). This
// supervisor uses no socket-probe wire code — liveness is child-process state, not a dial.
//
// The host DOES dial the au-mcp socket elsewhere, though: `retention.ts` is a control-plane
// client over `@arsumbris/au-mcp-sdk` (session retention). That is the sanctioned "kernel
// exposes a control read, the app consumes it" channel; it does not change this supervisor,
// which stays child-process-based.
//
// The au-mcp CLI is a TS entry run under node type-stripping; the node binary, its
// args, and the CLI path come from the tool-paths config (`tool-paths.ts`).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'


/** How to spawn the au-mcp daemon for a workspace. */
export interface McpSpawnConfig {
  /** The node binary (PATH name or absolute). */
  node: string
  /** Node args before the script (e.g. `--experimental-strip-types`). */
  nodeArgs: string[]
  /** The au-mcp CLI entry (`.../au-mcp/src/cli.ts`). */
  cliPath: string
  /** The workspace root (the same root the engine daemon serves). */
  workspace: string
}

export interface SupervisedMcpStatus {
  /** This supervisor owns a live au-mcp child process. */
  running: boolean
  /** The child announced it is listening on its socket (ready to broker). */
  listening: boolean
}

export type McpResult = { ok: true } | { ok: false; error: string }

const DEFAULT_FORCE_AFTER_MS = 1500

/** Split a stream into non-empty lines for a log surface. */
function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let rest = ''
  return (chunk) => {
    rest += chunk.toString('utf8')
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) if (line.length > 0) onLine(line)
  }
}

export class McpSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private childWorkspace: string | null = null
  private listening = false

  /** Assign to receive the child's log lines and its exit. */
  onLog: (line: string) => void = () => {}
  onExit: (code: number | null) => void = () => {}

  status(workspace: string): SupervisedMcpStatus {
    const owned = this.childWorkspace === workspace && this.child !== null
    return { running: owned, listening: owned && this.listening }
  }

  /**
   * Spawn the au-mcp daemon over the workspace as an owned child. Refuses when
   * this supervisor already owns one. Resolves once the spawn is confirmed (a
   * bad node/CLI path comes back as `{ ok: false, error }` synchronously via
   * node's `'error'` event); a daemon that starts then dies is surfaced via
   * `onExit`. The child is a long-running server, so we do NOT wait for exit.
   */
  async start(config: McpSpawnConfig): Promise<McpResult> {
    // au-mcp and the engine daemon hash the same workspace entry for socket identity.
    // au-mcp uses engine-sdk's `socketPath` to dial the engine and bind its own socket.
    // The folder-repo entry is also the root and home, so the same directory supplies the child cwd
    // and ownership-tracking key.
    const workspace = config.workspace
    // WORKSPACE SWITCH: if we own an au-mcp for a DIFFERENT workspace, stop it first — else the
    // guard below refuses and the gate (now on the new workspace) can't reach the old child. Same
    // stranding as the engine daemon; one au-mcp at a time, so leaving a workspace stops its mcp.
    if (this.child && this.childWorkspace && this.childWorkspace !== workspace) {
      this.onLog(`switching workspace — stopping au-mcp for ${this.childWorkspace}`)
      await this.stop(this.childWorkspace)
    }
    if (this.child) {
      return { ok: false, error: 'the host already owns a running au-mcp daemon' }
    }

    // Entry (identity) for the `start` arg; root dir for the child's cwd. Two distinct values.
    const args = [...config.nodeArgs, config.cliPath, 'start', config.workspace]
    const child = spawn(config.node, args, { cwd: workspace, env: process.env })

    const outcome = await new Promise<McpResult>((resolve) => {
      const settle = (result: McpResult): void => {
        child.removeListener('spawn', onSpawn)
        child.removeListener('error', onError)
        child.removeListener('exit', onEarlyExit)
        resolve(result)
      }
      const onSpawn = (): void => settle({ ok: true })
      const onError = (err: Error): void =>
        settle({ ok: false, error: `failed to spawn au-mcp (${config.node}): ${err.message}` })
      const onEarlyExit = (code: number | null): void =>
        settle({ ok: false, error: `au-mcp exited before it started (code ${code})` })
      child.once('spawn', onSpawn)
      child.once('error', onError)
      child.once('exit', onEarlyExit)
    })
    if (!outcome.ok) return outcome

    // Spawn confirmed — adopt the child (no event-loop turn passed, so no exit slipped through).
    this.child = child
    this.childWorkspace = workspace
    this.listening = false

    const onLine = (line: string): void => {
      // The CLI prints `au-mcp daemon listening on <socket>` to stderr once serving.
      if (!this.listening && /listening on/i.test(line)) this.listening = true
      this.onLog(line)
    }
    child.stdout.on('data', lineSplitter(onLine))
    child.stderr.on('data', lineSplitter(onLine))

    let exited = false
    const notifyExit = (code: number | null): void => {
      if (exited) return
      exited = true
      detachStdio(child) // stop reading the pipes so a late read cannot race the close (see detachStdio).
      this.child = null
      this.childWorkspace = null
      this.listening = false
      this.onExit(code)
    }
    child.on('error', (err) => {
      this.onLog(`au-mcp error: ${err.message}`)
      notifyExit(null)
    })
    child.on('exit', (code) => notifyExit(code))

    return { ok: true }
  }

  /**
   * Stop the owned au-mcp daemon with a graceful SIGTERM (its signal handler
   * stops the server and unlinks the socket), escalating to SIGKILL if it hangs.
   */
  async stop(workspace: string, forceAfterMs = DEFAULT_FORCE_AFTER_MS): Promise<McpResult> {
    const child = this.childWorkspace === workspace ? this.child : null
    if (!child) return { ok: false, error: 'the host does not own an au-mcp daemon for this workspace' }
    detachStdio(child) // stop consuming stdio before the kill, so no pending read races the pipe close.
    child.kill('SIGTERM')
    const exited = await waitForExit(child, forceAfterMs)
    if (!exited) {
      this.onLog('au-mcp graceful shutdown timed out, sending SIGKILL')
      child.kill('SIGKILL')
    }
    return { ok: true }
  }

  /** Best-effort teardown of the owned child, for app quit. */
  dispose(): void {
    if (this.child) {
      detachStdio(this.child) // stop consuming stdio before the kill (see detachStdio).
      this.child.kill('SIGTERM')
    }
  }
}

/**
 * Stop consuming the child's stdout/stderr pipes before it dies. PAUSING removes the flowing-mode read
 * WITHOUT closing the read end (closing would EPIPE the daemon's next write). This avoids the macOS/libuv
 * fault where an abrupt pipe close delivers a positive `nread` to `Pipe.onStreamRead`, which throws
 * `ERR_OUT_OF_RANGE` out of a libuv callback — an uncatchable uncaught exception (a stream 'error' handler
 * cannot see it). The only prevention is to not be reading when the pipe closes. Best-effort + idempotent.
 */
function detachStdio(child: ChildProcessWithoutNullStreams): void {
  for (const stream of [child.stdout, child.stderr]) {
    try {
      stream.removeAllListeners('data')
      stream.pause()
    } catch {
      // teardown best-effort — an already-destroyed stream needs nothing.
    }
  }
}

/** Resolve true if the child exits within `ms`, false on timeout. */
function waitForExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, ms)
    child.once('exit', onExit)
  })
}
