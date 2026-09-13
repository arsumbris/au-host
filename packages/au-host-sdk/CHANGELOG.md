# Changelog

Contract and API history of `@arsumbris/au-host-sdk`, the host/projection mount contract.
This tracks breaking contract changes and notable additions, rather than semver releases.
The package stays at `0.0.0`; entries are date-grouped, newest first.

au-host-sdk depends on `@arsumbris/engine-sdk` for the engine wire types it forwards.
A wire-shape change there can ripple into the engine surface re-exposed via `MountHost`.

## 2026-09-11 — Navigation sequence inspection

Add optional composition `key-sequence-timeout-ms`, dispatcher inspection pause/refill, and timing
metadata on pending snapshots. No mount capability/version change; existing timeout remains 600ms
when omitted. Zero disables expiry. Navigation UI consumes the same authority timer for its ring.

## 2026-09-08 — remove `children.mountWindow`, `MOUNT_CONTRACT_VERSION` 6 → 7 (BREAKING)

Breaking. The handshake is strict integer equality, so every projection (incl. cross-repo ones like au-workflow's plan-view) must re-declare `contractVersion: 7` to mount.

Removes the legacy `children.mountWindow(child, options?)` verb. It opened a child in its own SECOND runtime over the RPC transport — the two-runtime detached-window model. That model is superseded by windows-as-pool-records: ONE authority `CompositionRuntime` drives every OS window as a mount SURFACE, and floating is a pool re-parent under a `window` record, not a separate windowing verb.

The replacement surface landed additively across the cross-window work and is unchanged by this bump: `children.pool.float?(occupantId, sourceEdit, options?)` (open in a NEW window) and `children.pool.moveToWindow?(subtreeId)` (move into an EXISTING window), both optional-guarded. `WindowOptions` stays (now consumed by `float`). `ChildHandle` stays (returned by `children.mount`).

### Removed

- `MountHost.children.mountWindow`. A container that opened a floating child migrates to `children.pool.float`.

## 2026-07-01 — ThemeControl active named-theme (additive, optional)

Additive, non-breaking. `MOUNT_CONTRACT_VERSION` unchanged (5); still on the OPTIONAL `MountHost.theme`.

Extends the theme surface with the active NAMED theme, beneath the anonymous tweak layer.

### Added

- `ThemeControl.getActiveTheme(): { name, css } | null` and `setActiveTheme(theme | null)`. A named theme is a set of `--au-*` overrides authored as CSS (a `theme` instance's `styles`); the host injects it as a layer under the `save()`/`getOverrides()` tweaks and re-applies it on boot, so the active theme survives reload.

## 2026-07-01 — theme surface on MountHost (additive, optional)

Additive, non-breaking. `MOUNT_CONTRACT_VERSION` unchanged (5). Existing projections are unaffected; the member is OPTIONAL, so nothing breaks the handshake or requires a rebuild.

A theme is a set of `--au-*` overrides the host applies inline on `:root` — the cascade re-themes host chrome and every projection at once. This is the anonymous per-machine tweak tier: the host persists the overrides locally and re-applies them on boot, so a theme survives reload whether or not the theming pane is mounted. A named, shareable theme (a `*.theme.css` file + a thin `theme` instance with `extends`) is a separate save-as path, not this.

### Added

- `ThemeControl` interface — `getOverrides()` / `save(overrides)` / `clear()`. One app-global layer (unlike per-instance `ViewStore`).
- `MountHost.theme?: ThemeControl` — OPTIONAL surface member. A consumer guards (`host.theme?.save(...)`); a host that predates it omits it.
- `MountHostInfo.theme?` — forwarded by `createMountHost`.
- No `MOUNT_CONTRACT_VERSION` bump: an OPTIONAL member is genuinely additive (no existing projection references it, so none fails the handshake). Contrast the v5 bump, which added REQUIRED members.

## 2026-07-01 — customTokenEntry on projection-runtime-meta (additive)

Additive, non-breaking. `MOUNT_CONTRACT_VERSION` unchanged (5). Existing projections are unaffected; the field is optional and orthogonal to the mount RPC surface.

Part of au-host's styling/theming work: tokens are declared in pure CSS via `@property` and discovered at runtime by walking the CSSOM. A projection surfaces its OWN themeable tokens by pointing at declarations-only stylesheet(s); the host eager-loads them at document level for ALL in-scope projections (mounted or not) so a theming pane can enumerate them.

### Added

- `projection-runtime-meta` gains `customTokenEntry?: String[+]` — token-declaration stylesheet(s) relative to the package root. Declarations-only (`@property` + `:root` custom-property defaults, optional `prefers-color-scheme` wrappers), NOT component CSS. Optional; most projections omit it; non-empty when present.
- `ProjectionRuntimeMeta.customTokenEntry?: string[]` in the generated interface.
- `checkProjectionMeta` validates it (a non-empty array of non-empty strings when present) and carries it through the narrowed meta.
- No `MOUNT_CONTRACT_VERSION` bump: the field is read FROM the projection's meta, it does not change the `MountHost` surface a projection builds against.

## 2026-06-29 — second host-stand-in promotion pass (v5)

`MOUNT_CONTRACT_VERSION` 4 -> 5. Breaking. A v4 projection now fails the handshake.
Promotes the read-before-write guard, view-state channels, terminal and compositor surfaces from host-local interfaces. Composition writes, layout context and host lifecycle controls remain outside this contract version.

### Changed

- `MOUNT_CONTRACT_VERSION` 4 -> 5.
- `FilesControl.write` / `.delete` gain a trailing `expectedHash?: string`: the read-before-write guard. Pass the last-read hash and a mismatch is REJECTED without writing (a `conflict`), not clobbered. Omitting it is a blind write (unchanged behaviour). Fully engine-backed — the engine SDK's `mutate` already rejects a stale `expectedHash` with `current_hash`.
- `MountHostInfo` + `createMountHost` forward the new host-supplied facts (`intent`, `focus`, `viewStore`, `instanceId`, `terminal`, `listContributions`, `listProjections`, `preview`) untouched, exactly as they already forward `selection` / `viewState`.
- `SelectionChannel` doc: `focus` is now its promoted sibling, no longer "Future".

### Added

- Guard result fields: `FileReadResult.hash?` (read-time content hash, the guard baseline; absent → blind write) and `FileWriteResult.version?` (post-mutation vault version, the echo-suppression key) / `hash?` (post-write hash, seeds the next guarded write) / `conflict?: { currentHash }` (present on a guard rejection, so a consumer surfaces a conflict instead of clobbering).
- Cluster A, the view-state channels: `MountHost.intent: IntentChannel` (+ `IntentPayload`) — a tree-scoped COMMAND channel, fire typed intents / declare capabilities / host routes to the focused capable handler, payload-OPAQUE (vocab in `@arsumbris/intent`). `MountHost.focus: FocusChannel` — the state sibling tracking the active container per scope, feeds intent routing. `MountHost.viewStore: ViewStore` — a per-instance RESTORABLE view-state slot persisted locally outside the git-tracked config (the settings-vs-state split).
- Cluster B, the terminal: `MountHost.terminal: TerminalChannel` (+ `TerminalSession`) — a host-owned pty scoped per instance; the session survives a remount (detach + reattach) and is never killed by it. `MountHost.instanceId?: string` — the pane's stable `^:` node id, the key shared by `viewStore` and the terminal session; a projection that must survive its own remount caches by it.
- Cluster E (1-3), the compositor surfaces: `MountHost.listContributions(role): ChromeContribution[]` — the candidates of a projection KIND, discovered live; the host only ANSWERS (candidates, not a merge). `MountHost.listProjections(): string[]` — the discovered mountable projection type names, read live. `MountHost.preview: PreviewSurface` (+ `FillFn` / `LinkResolver`) — the per-window ephemeral overlay site; the host owns the card chrome, the caller's `fill` owns the content.

### Deviations from the request shapes (au-host to adopt)

- `listContributions` param is named `role`, not the inventory's `kind`. It matches the `ChromeContribution.role` field and the live stand-in; post kind-collapse the role IS the projection kind. Call sites are positional, so adoption is unaffected.
- `listContributions` / `listProjections` / `preview` are promoted NON-optional (the stand-in typed them `?`). Matches every other `MountHost` capability (always-present) and drops consumer null-checks. au-host already implements all three.
- `PreviewSurface` matches the richer use-site shape, not the inventory summary: it carries `isOver(x, y)` and a `linkResolver?` (nesting via `FillFn` / `LinkResolver`), and DOM types (`HTMLElement` / `DOMRect`) — correct for this DOM-carrying SDK.

### Deferred (still host stand-ins, not promoted)

- Cluster C, the composition write path (`commitComposition`, `stageRefSaves`) — less settled (node-refs GUI-verify-pending). Pairs with the guard but the guard ships standalone; revisit when node-refs settles.
- Cluster E.4, the container layout-context — still a DOM-attribute convention (`data-au-axis` / `data-au-edge`), not a typed surface yet. Promote once typed host-side.
- Cluster D, host chrome: `daemon` (user-driven host concern), `engineReady` (waits on a REAL engine readiness edge filed upstream in au-engine-sdk, not a host-local poll frozen into the contract), `windowRoot` (detached-window plumbing).

## 2026-06-21 — host-composition surface folded into the contract (v3)

`MOUNT_CONTRACT_VERSION` 2 -> 3. Breaking. A v2 projection now fails the handshake.
Promotes configuration persistence, file operations, workspace topology and selection from host-local interfaces into the mount contract. Daemon lifecycle and readiness remain host-local in this version.

### Changed

- `MOUNT_CONTRACT_VERSION` 2 -> 3.
- `MountHost.children.mount` child param gains `config?` and `onConfigChange?`: a parent hands a child its sub-config and receives the child's `saveConfig` writes, re-saving up the tree. `mountWindow` is unchanged (no config parameter in this version).
- `MountHostInfo` + `createMountHost` forward the new host-supplied facts (`config`, `saveConfig`, `files`, `workspace`, `selection`) untouched, exactly as they already forward `children` / `viewState`.

### Added

- `MountHost.config?` + `MountHost.saveConfig(next)`: the model-B config round-trip. The host mounts a projection with its instance as `config`; `saveConfig` persists changes back up to the composition.
- `MountHost.files: FilesControl` (`read` / `write` / `exists` / `delete`) + `FileReadResult` / `FileWriteResult`: vault-bound file I/O, fully engine-backed (read/exists via the `content` read, write/delete via the governed member-aware mutation channel). No raw fs.
- `MountHost.workspace: { members: WorkspaceMember[] }` + `WorkspaceMember` (`name` / `root` / `scattered`): multi-root content topology, backed by the engine `members` read. Sits beside `vault.path` (binding vs content topology).
- `MountHost.selection: SelectionChannel` (`publish` / `follow`): a tree-scoped, payload-OPAQUE selection channel. A view publishes its own selection, it bubbles up the mount tree, a consumer follows its enclosing container's. The higher-level surface layered above the per-publisher `viewState` bus; both stay. The payload vocabulary (`selection` / `range`) lives in first-party packages, never this SDK.

### Deferred (still host stand-ins, not promoted)

- `daemon` (lifecycle: status/start/stop bound to the active config) and `engineReady` (the daemon-reachable edge) — host-chrome, lower priority. `engineReady` waits on a real engine readiness edge before it earns a contract shape (a gap filed upstream, not frozen as a host-local poll).
- the `focus` channel (the second tree-scoped view-state channel) — Future.

## 2026-06-19 — model B: projection is an open base, configs are instances

Breaking rework of the owned type vocabulary. `MOUNT_CONTRACT_VERSION` stays 2; the runtime mount path (`MountHost`, RPC, composition, viewState) is unchanged. No external users, so no migration.

### Changed

- `projection` is now an open BASE type-def (`fields: []`). Real views are SUBTYPES (`type: projection`) whose fields ARE that view's config; an instance of a subtype IS a config. The old flat manifest type (`id`/`name`/`contractVersion`/`entry`/`configType`) is gone.
- `checkManifest` -> `checkProjectionMeta(value)`. Validates a `projection-runtime-meta` record (`entry`, `contractVersion`) read off a subtype's type-def (`readType` -> `meta_blocks`), plus the version handshake. `ManifestCheck` -> `ProjectionMetaCheck` (`{ ok, meta }`). No more `manifest.json`; code resolves through the type owner (`type_sites`) + the meta's `entry`.

### Removed

- the `projection-config` base type-def and its generated `ProjectionConfig` — a projection subtype IS its config-def.
- the `composition` type-def and its generated `Composition` — a saved composition is just a root projection instance.

### Added

- `projection-runtime-meta` type-def + generated `ProjectionRuntimeMeta` (`entry`, `contractVersion`): the type-level meta each subtype carries to declare its loadable code.

## 2026-06-09 — MountHost is RPC-shaped (v2)

### Changed

- `MOUNT_CONTRACT_VERSION` 1 -> 2. Breaking. A v1 by-reference projection now fails the handshake.
- `MountHost` is RPC-shaped: its engine surface is brokered over a transport, so a projection can run in its own OS-level window. The projection-facing API is unchanged: `host.engine.read(...)` / `host.engine.subscribe(...)` still.

### Added

- `HostTransport`: the transport-agnostic message channel the host implements (a direct in-process channel in its own renderer, an Electron bridge for a detached window).
- `ProjectionToHost` / `HostToProjection`: the protocol message types (read request/response; subscribe channel, events, unsubscribe).
- `createMountHost(transport, info)`: the projection-side adapter that re-presents a transport as a `MountHost`. Mints request/channel ids client-side, so `subscribe` returns its unsubscribe synchronously; the broker tolerates unsubscribe-before-subscribe.
- `MountHost.children` + `ChildHandle`: the brokered child-mount verb. A projection mounts another into a slot it owns: `host.children.mount(slot, { id }): Promise<ChildHandle>`. The host resolves `id`, mints the child's host, and cascades unmount. Additive within v2. `MountHostInfo.children` is the host-supplied implementation the adapter forwards; the loader and tree live in au-host.
- `children.mountWindow(child, options?)` + `WindowOptions`: open-as-floating-window. Windowing is composition with a window slot, not a separate namespace — it reuses `ChildHandle`, the tree, and the RPC bridge transport. Closing the window unmounts the child. Additive within v2. Relocating a running projection across the boundary (with state) is deferred.
- `MountHost.viewState` + `PublisherId`: the ephemeral view-state bus (linked viewports). Per-publisher awareness: `publish(slice, value)` under your own host-minted identity, `follow(publisher, slice, cb)` to track one publisher. Retained last-value, schema-agnostic, vault-scoped, never persisted, never sent to the engine. `ChildHandle` gains `publisher` (the child's identity, for wiring links). `MountHostInfo.viewState` is the host-supplied bus the adapter forwards. Additive within v2. Presence across all publishers (`watchAll`) is reserved.

## 2026-06-08 — extracted from au-engine-sdk

The mount contract was promoted out of au-engine-sdk's `./mount` subpath into this repo.
See `au-engine-sdk`'s CHANGELOG entry of the same date for the consumer migration.

### Added

- The projection mount contract as the package root export: `ProjectionManifest`, `MountHost`, `ProjectionModule`, `checkManifest`, `MOUNT_CONTRACT_VERSION`.
- Engine edge types (`EngineReadResult`, `SubscriptionEvent`, `ReadRequest`, `SubscribeRequest`) are imported from `@arsumbris/sdk/wire`, not redefined here.
