// The main-process au-mcp retention client exposes dormant sessions and the configurable dormancy
// window, including a preview of affected sessions. These are sessionless control requests under
// host/user authority, not agent tools. au-mcp owns storage and persistence; the host calls its typed verbs.
// Derive the daemon socket from the workspace entry. Each call connects, invokes, and closes so
// user-driven daemon restarts cannot strand a cached connection. An unavailable daemon returns
// `{ ok: false, error }` rather than throwing.

import { createDaemonClient, type DaemonClient } from '@arsumbris/au-mcp-sdk/client'
import { connectSocket, socketPath } from '@arsumbris/au-mcp-sdk/socket'

import type {
  DormantSessionsResult,
  RetentionConfigResult,
  RetireSessionResult,
} from '../shared/daemon-api'

/** Connect to the au-mcp daemon for `entry`, run one verb, then dispose + close. Never leaks a socket. */
async function withClient<T>(entry: string, fn: (client: DaemonClient) => Promise<T>): Promise<T> {
  const transport = await connectSocket(socketPath(entry))
  const client = createDaemonClient(transport)
  try {
    return await fn(client)
  } finally {
    client.dispose()
    transport.close()
  }
}

/** Turn any failure (daemon down, timeout, wrong-kind reply) into a legible error string. */
function errMsg(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return `au-mcp daemon unreachable or failed: ${message} — is the mcp daemon running for this workspace?`
}

/** The dormant sessions to show for "resume or clean up". */
export async function listDormant(entry: string): Promise<DormantSessionsResult> {
  try {
    const sessions = await withClient(entry, (c) => c.listDormant())
    return { ok: true, sessions }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** DRY-RUN blast radius: the dormant sessions a proposed `windowMs` would retire. */
export async function retentionPreview(entry: string, windowMs: number): Promise<DormantSessionsResult> {
  try {
    const sessions = await withClient(entry, (c) => c.retentionPreview(windowMs))
    return { ok: true, sessions }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** The current dormancy window. */
export async function retentionConfig(entry: string): Promise<RetentionConfigResult> {
  try {
    const cfg = await withClient(entry, (c) => c.retentionConfig())
    return { ok: true, ...cfg }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** Persist a new dormancy window (days); returns the applied window. */
export async function setRetentionWindow(entry: string, windowDays: number): Promise<RetentionConfigResult> {
  try {
    const cfg = await withClient(entry, (c) => c.setRetentionWindow(windowDays))
    return { ok: true, ...cfg }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}

/** Explicitly retire one named dormant session now. */
export async function retireSession(entry: string, session: string): Promise<RetireSessionResult> {
  try {
    const r = await withClient(entry, (c) => c.retireSession(session))
    return { ok: true, session: r.session }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}
