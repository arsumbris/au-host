// Persistent daemon connections for engine reads.
//
// One client per entry, connected on demand, reconnected on the next read
// after a connection drops. Distinct from the panel's probe (which connects
// per probe by design): reads from projections want a held connection so
// per-ref versions stay comparable and subscriptions have a home.

import { DaemonClient, manageConnection, toTypedSubscriber } from '@arsumbris/au-engine-sdk'
import type {
  ManagedConnection,
  ReadRequest,
  SubscribeRequest,
  SubscriptionEvent,
  TypedMutate,
} from '@arsumbris/au-engine-sdk'
import { readContent, readDeviceConfig, readResolveMember, readResolveTarget } from '@arsumbris/au-engine-sdk/reads'
import { isAbsolute, normalize, relative, sep } from 'node:path'
import type { WireDeviceConfigResult, WireReader } from '@arsumbris/au-engine-sdk/reads'

import type { DeviceConfigResult, EngineReadResult, FileReadResult, FileWriteResult, RegisterResult } from '../shared/daemon-api'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * How long a read waits for an in-flight connect before failing fast. The
 * managed connection retries with backoff forever; a read should not hang on
 * that, so it gives up after this and surfaces "no daemon reachable" (a
 * projection re-fetches on the readiness edge when the daemon comes up).
 */
const CONNECT_TIMEOUT_MS = 2000

export class EngineConnections {
  // One managed connection per entry: it eagerly connects, observes death and
  // auto-reconnects with backoff, and exposes the connection-state machine.
  // Reads/subscriptions acquire their client from it, and engine readiness is
  // simply its `connected` edge.
  private managers = new Map<string, ManagedConnection<DaemonClient>>()

  // Per-entry consumer refcount (active subscriptions + ready-watchers). When it returns to
  // zero the managed connection is closed and evicted, so an entry that churned away (its
  // window/composition unmounted) stops its socket + perpetual reconnect backoff. One-shot
  // reads do not retain — in this app an active entry always holds a readiness watcher.
  private refs = new Map<string, number>()

  /**
   * Readiness push hook, wired by main to the renderer. Fires on every
   * connection-state transition with `connected` as the ready flag, so a
   * projection re-fetches on the not-ready→ready edge (and learns of a drop).
   */
  onReadyChange: ((entryPath: string, ready: boolean) => void) | null = null

  /** The managed connection for an entry, created (and started connecting) on first use. */
  private manager(entryPath: string): ManagedConnection<DaemonClient> {
    let mgr = this.managers.get(entryPath)
    if (!mgr) {
      mgr = manageConnection(() => DaemonClient.connect(entryPath))
      this.managers.set(entryPath, mgr)
      mgr.onStateChange((state) => this.onReadyChange?.(entryPath, state === 'connected'))
    }
    return mgr
  }

  /**
   * Resolve a connected client for an entry. Immediate when already connected;
   * otherwise awaits the in-flight connect but fails fast (rather than hanging
   * through the manager's backoff) when no daemon answers — preserving the
   * "no daemon reachable" read semantics.
   */
  private async client(entryPath: string): Promise<DaemonClient> {
    const mgr = this.manager(entryPath)
    if (mgr.client) return mgr.client
    return Promise.race([
      mgr.acquire(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('connect timed out')), CONNECT_TIMEOUT_MS),
      ),
    ])
  }

  /**
   * Ensure an entry's connection is being managed (so readiness edges flow) and
   * report its current readiness. Called when the renderer starts watching.
   */
  watchReady(entryPath: string): boolean {
    return this.manager(entryPath).state === 'connected'
  }

  /** Pin an entry's managed connection (a subscription or ready-watcher started). */
  retainEntry(entryPath: string): void {
    this.refs.set(entryPath, (this.refs.get(entryPath) ?? 0) + 1)
  }

  /** Release an entry pin; at zero, close + evict the manager so it stops reconnecting. */
  releaseEntry(entryPath: string): void {
    const next = (this.refs.get(entryPath) ?? 0) - 1
    if (next > 0) {
      this.refs.set(entryPath, next)
      return
    }
    this.refs.delete(entryPath)
    const mgr = this.managers.get(entryPath)
    if (mgr) {
      mgr.close()
      this.managers.delete(entryPath)
    }
  }

  /**
   * The managed `DaemonClient` for an entry, typed as a `WireReader` — for the typed read helpers
   * (`readSubtypes`, …) that take a reader directly, e.g. adapter discovery. Reuses the same managed,
   * reconnecting connection as `read`; the caller only issues reads, never owns the client's lifecycle.
   */
  async wireReader(entryPath: string): Promise<WireReader> {
    return this.client(entryPath)
  }

  async read(entryPath: string, request: ReadRequest): Promise<EngineReadResult> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      return { ok: false, error: `no daemon reachable for this entry (${message(err)})` }
    }
    try {
      const frame = await client.read(request)
      // ResponseFrame is discriminated on `ready` (SDK v4); narrow so the
      // ready arm carries its guaranteed numeric version.
      return frame.ready
        ? { ok: true, ready: true, version: frame.version, result: frame.result }
        : { ok: true, ready: false, version: frame.version, result: frame.result }
    } catch (err) {
      // The connection may have died mid-read; the next read reconnects.
      return { ok: false, error: message(err) }
    }
  }

  /**
   * Write a file through the engine's governed mutation channel (the `mutate`
   * verb), so writes are mediated and the engine re-derives. `filePath` follows the read address space: a
   * workspace-root-relative or absolute path. The channel is member-aware, so a
   * scattered member (the host's real topology) is reached by absolute path,
   * symmetric with reads.
   *
   * `expectedHash` is the read-before-write guard: the hash the caller last read
   * (from `readFile`'s `hash` or a prior write's `hash`). A mismatch is REJECTED
   * without writing and surfaces as `{ ok: false, conflict: { currentHash } }`
   * rather than clobbering. Absent means overwrite-regardless (a new file needs none).
   */
  async writeFile(
    entryPath: string,
    filePath: string,
    content: string,
    expectedHash?: string,
  ): Promise<FileWriteResult> {
    return this.mutate(entryPath, (client) => client.writeFile(filePath, content, { expectedHash }))
  }

  /**
   * Move `from` to `to` and rewrite every inbound reference (`mutate: rename`). Same-repo only
   * (a cross-member move rejects) and a type-def file rejects — the engine's rename contract.
   */
  async rename(entryPath: string, from: string, to: string): Promise<FileWriteResult> {
    return this.mutate(entryPath, (client) => client.rename(from, to))
  }

  /**
   * Read a file through the daemon's `content` read. An absent file maps to a not-ok read.
   * The response includes the source and its content hash together, providing the `expected_hash`
   * write guard whenever the file is readable, including while the daemon is deriving.
   */
  async readFile(entryPath: string, filePath: string): Promise<FileReadResult> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      return { ok: false, error: `no daemon reachable for this entry (${message(err)})` }
    }
    try {
      const content = await readContent(client, filePath)
      if (!('ready' in content)) return { ok: false, error: content.error }
      if (!content.ready) return { ok: false, error: 'engine is deriving; retry once ready' }
      if (content.result === null) return { ok: false, error: 'file does not exist' }
      return { ok: true, content: content.result.text, hash: content.result.hash }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }

  /**
   * Resolve a `file*` target (a wikilink target, repo-relative path, or discovered absolute path; no `[[ ]]`)
   * to its absolute on-disk path via the engine's `resolve_target` read. Returns null
   * when it does not resolve, is ambiguous, the daemon is deriving, or is unreachable —
   * never throws. The engine only resolves within-workspace files, so this doubles as
   * the containment for the asset-serving scheme.
   */
  async resolveTarget(entryPath: string, target: string): Promise<string | null> {
    try {
      const client = await this.client(entryPath)
      // File discovery yields absolute paths; resolve_target speaks reference grammar.
      // Ask the engine for ownership, then resolve within that member's index. Ownership
      // alone does not prove a file is in scope or exists: the second read remains the gate.
      let reference = target
      const absolute = isAbsolute(target) ? normalize(target) : null
      if (absolute !== null) {
        const owner = await readResolveMember(client, absolute)
        if (!('ready' in owner) || !owner.ready || !owner.result) return null
        const local = relative(owner.result.root, absolute)
        if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) return null
        reference = `${local.split(sep).join('/')}::${owner.result.repo}`
      }
      const result = await readResolveTarget(client, reference)
      if (!('ready' in result) || !result.ready) return null
      // Reference grammar must never reinterpret a literal filename as another file.
      if (absolute !== null && (!result.result || normalize(result.result.path) !== absolute)) return null
      return result.result?.path ?? null
    } catch {
      return null
    }
  }

  /** Whether a file exists, via the `content` read (`null` = absent). */
  async fileExists(entryPath: string, filePath: string): Promise<boolean> {
    try {
      const client = await this.client(entryPath)
      const result = await readContent(client, filePath)
      return 'ready' in result && result.ready && result.result !== null
    } catch {
      return false
    }
  }

  /**
   * Delete a file through the governed mutation channel (`mutate: delete_file`),
   * member-aware like `writeFile`. `expectedHash`
   * is the same read-before-write guard (a mismatch rejects as a conflict, no delete).
   */
  async deleteFile(entryPath: string, filePath: string, expectedHash?: string): Promise<FileWriteResult> {
    return this.mutate(entryPath, (client) => client.deleteFile(filePath, { expectedHash }))
  }

  /**
   * Re-scope a member's file scope through the governed `set_ignores` mutation:
   * replace the member `root`'s `.auignore` lines with `patterns` (a FULL
   * replacement; an empty list removes the file, reverting to the default
   * excludes). A CONFIG-sort mutation (it edits which content enters the graph,
   * not graph content), so the envelope is delete-style with a null `hash`; the
   * re-scope runs before the response, so the returned `version` already reflects
   * the new scope. Relaxed integrity: it MAY orphan references (advisory
   * diagnostics, never a rejection); a non-member `root` or a malformed pattern
   * rejects with no write.
   */
  async setIgnores(entryPath: string, root: string, patterns: string[]): Promise<FileWriteResult> {
    return this.mutate(entryPath, (client) => client.setIgnores(root, patterns))
  }

  /**
   * Register (or update) a repo's device-global location: write `name`→`{ path, remote? }`
   * into `~/.arsumbris/au-engine/config/repos.yaml` and rebuild so a newly-locatable member mounts.
   * The schema-12 folder-picker bootstrap for a `peer-unmounted` dependency. A CONFIG-sort mutation over a device-global file, so
   * NO git commit; it answers a distinct `registered` frame (echoed name/path + post-rebuild
   * version). A reject the connection survives (invalid name, `dependency-identity-conflict`,
   * an unreadable/absent `repo.yaml` at `path`) maps to `{ ok: false, error }`.
   */
  async register(entryPath: string, name: string, path: string, remote?: string): Promise<RegisterResult> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      return { ok: false, error: `no daemon reachable for this entry (${message(err)})` }
    }
    try {
      const outcome = await client.register(name, path, remote)
      return outcome.ok
        ? { ok: true, name: outcome.result.name, path: outcome.result.path, version: outcome.result.version }
        : { ok: false, error: outcome.error }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }

  /**
   * Read the per-user device-global engine-schema files (`repos.yaml` / `workspaces.yaml`)
   * with their field-shape diagnostics — the "where do my repos resolve on this machine" view,
   * and the first-run detector (a null/absent `repos` means no device registry yet).
   */
  async readDeviceConfig(entryPath: string): Promise<DeviceConfigResult> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      return { ok: false, error: `no daemon reachable for this entry (${message(err)})` }
    }
    try {
      const res = await readDeviceConfig(client)
      if (!('ready' in res)) return { ok: false, error: res.error }
      if (!res.ready) return { ok: false, error: 'engine is deriving; retry once ready' }
      return { ok: true, config: res.result as WireDeviceConfigResult | null }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }

  /** Shared mutation plumbing: resolve the client, map `TypedMutate` to a result. */
  private async mutate(
    entryPath: string,
    run: (client: DaemonClient) => Promise<TypedMutate>,
  ): Promise<FileWriteResult> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      return { ok: false, error: `no daemon reachable for this entry (${message(err)})` }
    }
    try {
      const outcome = await run(client)
      // TypedMutate's three arms: the reject arm has `ok`, the other two `ready`.
      if ('ready' in outcome) {
        if (!outcome.ready) return { ok: false, error: 'engine is deriving; retry once ready' }
        // Carry the version (echo-suppression key) + post-write hash (seeds the next guarded write).
        return { ok: true, version: outcome.version, hash: outcome.result.hash ?? undefined }
      }
      // A read-before-write guard rejection carries `detail.current_hash`; surface it
      // as a conflict so the caller re-reads and merges instead of clobbering.
      const currentHash = (outcome.detail as { current_hash?: string } | undefined)?.current_hash
      return currentHash !== undefined
        ? { ok: false, error: outcome.error, conflict: { currentHash } }
        : { ok: false, error: outcome.error }
    } catch (err) {
      // The connection may have died mid-mutate; the next call reconnects.
      return { ok: false, error: message(err) }
    }
  }

  /**
   * Open a subscription, delivering normalized events.
   * Returns a detach function. A dead connection ends the subscription
   * with a `closed` event; re-subscribing is the consumer's move.
   */
  async subscribe(
    entryPath: string,
    request: SubscribeRequest,
    onEvent: (event: SubscriptionEvent) => void,
  ): Promise<() => void> {
    let client: DaemonClient
    try {
      client = await this.client(entryPath)
    } catch (err) {
      onEvent({
        kind: 'closed',
        error: `no daemon reachable for this entry (${message(err)})`,
        reason: 'transient',
      })
      return () => {}
    }
    // The SDK normalizes the raw frames to SubscriptionEvent; the frame is
    // just the IPC boundary, so it gates delivery on `detached`.
    this.retainEntry(entryPath)
    let detached = false
    const detach = toTypedSubscriber(client).subscribe(request, (event) => {
      if (!detached) onEvent(event)
    })
    return () => {
      if (detached) return
      detached = true
      detach()
      this.releaseEntry(entryPath)
    }
  }

  dispose(): void {
    for (const mgr of this.managers.values()) mgr.close()
    this.managers.clear()
  }
}
