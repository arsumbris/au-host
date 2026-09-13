// Agent-host transport PROTOCOL.

// The command protocol au-host serves over its socket and au-mcp's host-relay
// tools speak as clients. au-host-sdk OWNS it. Pure types + one version const —
// value-vocab-free (it carries opaque intent payloads without interpreting them,
// exactly like `SelectionChannel`/`IntentChannel` carry `unknown`), and no node
// imports: the byte framing is engine-sdk's `frame.ts`, wired by the socket
// server + the client in their own node modules, never here.

// LIVE / EPHEMERAL ONLY. Persistent composition authoring is NOT on this
// transport — au-mcp writes config through the engine mutation channel (the one
// governed write path it already has).


import type { PaneId } from './container'
// IntentPayload lives in the mount contract; a fireIntent command carries one
// verbatim (the host reads only `type`/`kind`/`dispatch`, forwards the rest).
// Type-only import, erased at compile — no runtime cycle with index's re-export.
import type { IntentPayload } from './index'

/**
 * The transport protocol version, bumped on any breaking command-set change.
 * Checked at the socket handshake (the analogue of `MOUNT_CONTRACT_VERSION` for
 * the mount contract); the server and the au-mcp client must agree or the
 * connection is refused loudly.
 */
export const HOST_TRANSPORT_PROTOCOL_VERSION = 1

// --- Commands ---------------------------------------------------------------
//
// Three live-runtime commands, all over renderer state:
// - `fireIntent`  → the renderer's `IntentTree.fire` (→ `{ claimed }`).
// - `introspect`  → a snapshot of the mounted composition tree + focus + handles.
// - `containerOp` → the `ContainerPlacement` seam (live layout manipulation).

/** A command a client sends to the host. Payload-opaque: `fireIntent` carries an
 *  intent whose body the host never interprets beyond its routing metadata. */
export type HostCommand =
  | { command: 'fireIntent'; intent: IntentPayload }
  | { command: 'introspect' }
  | { command: 'containerOp'; op: ContainerOp }

/** The result for each command, discriminated by the same `command` tag as the
 *  request that produced it. */
export type HostResult =
  | { command: 'fireIntent'; claimed: boolean }
  | { command: 'introspect'; snapshot: HostSnapshot }
  | { command: 'containerOp'; outcome: ContainerOpOutcome }

// --- Frames -----------------------------------------------------------------
//
// One JSON message per wire frame (the 4-byte length prefix + JSON body is
// engine-sdk's `encodeFrame`/`FrameDecoder`, reused verbatim by both ends).
// Every request carries a client-minted correlation id; the response echoes it,
// so many commands may be in flight over one connection.

/** A request frame: a correlation id plus the command. */
export interface HostRequestFrame {
  /** Client-minted, monotonic. The matching response echoes it. */
  id: number
  request: HostCommand
}

/** A response frame: the echoed id and either a typed result or an error. A
 *  command never throws across the wire — a failure is `ok: false` with a reason
 *  written for a human (mirrors the mount contract's `FileReadResult` style). */
export type HostResponseFrame =
  | { id: number; ok: true; result: HostResult }
  | { id: number; ok: false; error: string }

// --- introspect: the live snapshot -----------------------------------------
//
// The host-introspection surface: the mounted composition tree + focus + each
// node's declared `handles`. Structural only (node ids, projection type names,
// kinds, handled intent `type`s) — no selection/range value vocabulary crosses,
// so the snapshot stays value-vocab-free. Exposes everything for now; a trust
// boundary is a separate todo.

/** One node of the mounted composition tree. */
export interface SnapshotNode {
  /** The node's stable id in the mount tree (its pane / publisher id). */
  id: string
  /** The projection subtype name mounted here (its identity), or null for a node with
   *  no single projection type (e.g. a detached-window node). */
  projection: string | null
  /** The projection KIND closure — the type name plus every ancestor kind it plays
   *  (`pane-projection` / `container-projection` / `bar-projection` / …). Empty when the
   *  host cannot resolve it (the type is not in the current discovery snapshot). */
  kinds: string[]
  /** The intent `type`s this node's projection declares it handles (its `handles` meta,
   *  bare names). Empty when it declares none / is unresolved. */
  handles: string[]
  /** Child nodes, in mount order. */
  children: SnapshotNode[]
}

/** The focus state accompanying a snapshot. */
export interface SnapshotFocus {
  /** The most-recently-focused node id (the active container / view), if any. The host's
   *  focus channel tracks a recency list; this is its head. */
  activeNodeId?: string
}

/** A snapshot of the live host composition. */
export interface HostSnapshot {
  /** The root of the mounted composition tree. */
  root: SnapshotNode
  /** The current focus state. */
  focus: SnapshotFocus
}

// ContainerPlacement transport operations. activate addresses a pane by its stable PaneId
// without an opaque payload. The union permits additional container operations.

/** A container operation. */
export type ContainerOp =
  /** Show / focus the pane with this stable id, wherever it lives. Maps to
   *  `ContainerPlacement.activate`. */
  | { op: 'activate'; paneId: PaneId }
  /** Remove the pane with this stable id from whatever holds it. Maps to
   *  `ContainerPlacement.extract`, discarding the result.
   *
   *  Declines when the pane's slot is `fixed`, exactly as a drag out of it would — a rule that
   *  applied to gestures but not to this seam would be a hole straight through it. */
  | { op: 'close'; paneId: PaneId }

/** The outcome of a container operation. `done: false` carries a reason (e.g. no
 *  container holds the pane) instead of throwing. */
export type ContainerOpOutcome = { done: true } | { done: false; reason: string }

// --- The client contract (au-mcp's target) ---------------------------------

/**
 * The client half of the transport: what au-mcp's host-relay tools implement to
 * reach au-host. au-host-sdk OWNS the protocol; au-mcp CONNECTS. Minimal by
 * design — au-mcp owns HOW it acquires the socket path (via engine-sdk's
 * `socketFileName` on the workspace entry, with a `.host.sock` suffix) and how it
 * awaits readiness / retries. This fixes only the call/response shape both sides
 * bind to. The `host-relay` marker distinguishing a relay tool from a pure engine
 * tool is au-mcp's own concern (its shape TBD); this is the wire contract under it.
 */
export interface HostRelayClient {
  /** Send one command and await its correlated result. Rejects on transport
   *  failure (a closed socket, a protocol-version mismatch); a command-level
   *  failure returns as an `ok: false` frame the caller surfaces, not a reject. */
  send(command: HostCommand): Promise<HostResult>
  /** Close the connection. */
  close(): void
}
