---
type: au.engine.readme::au-engine
tldr: The projection mount contract for the au-host UI layer — the base type vocabulary a view extends, the composition document that arranges views, and the capability surface a mounted view receives. Build against it as the host, a first-party author, a third-party plugin, or an end user. Extend the UI by subtyping the projection base and authoring a composition, never by changing the host.
---

# Repo Overview

## General Context

Before defining what `au-host-sdk` is,
here is some general context of the environment it exists in.

- `arsumbris` is a framework for agentic knowledge work.
- `au-engine` serves a graph over a cross-repo substrate of typed files.
- `au-host` is the UI part of the framework — an Electron shell that mounts views over that graph.
- `au-mcp` is the agent layer of the framework.

`au-host-sdk` is part of this `arsumbris` framework.
It is the UI layer's **mount contract**.

`au-host-sdk` is the UI peer of the family's other two contract SDKs:
- `au-engine-sdk`, the client contract for the au-engine daemon.
- `au-mcp-sdk`, the plugin/adapter contract for the au-mcp agent kernel.


## What this is

`au-host-sdk` is the **projection mount contract** for `au-host`:
- the base **type vocabulary** every view extends
  - the `projection` base + its KIND hierarchy (`pane-projection`, `container-projection`, ...)
  - the `composition` document that arranges views into a workspace
  - the metas a view attaches (`projection-runtime-meta`, `projection-presentation-meta`, ...)
- the **capability surface** (`MountHost`) a view receives when the host mounts it
  - engine reads + subscriptions, files, the workspace shape
  - the view-state channels (intent / focus / selection / viewState)
  - styling, overlays, terminals, and more
- the **module contract** a view's loadable code satisfies
  - a typed `MountFn`, branded by `defineProjection`
  - a version handshake (`MOUNT_CONTRACT_VERSION`) checked at load

A **projection** is the GENERAL MECHANISM by which UI slots into the host and composes through it.
- the same contract serves three audiences over ONE surface:
  - **first-party** views (the editor, file tree, bento, ...),
  - **third-party** plugins,
  - **end-user** custom builds.
- the host owns the loader, the layout slots, and each site's chrome.
- a projection is the CONTENT that slots in. It does not know or care which site it is in.

The host holds only the MECHANISM.
Everything a user sees is a projection, arranged by a composition, mounted through this contract.


## The mount model

A projection is declared as a **type-def**, not registered by an id-string.
- a projection is a `projection` SUBTYPE type-def. The type NAME is its identity.
- its FIELDS are the view's config. An INSTANCE of the subtype IS a config.
- loadable code rides as type-def `meta` (`projection-runtime-meta`):
  - `entry` — the built ESM, relative to the owning package root.
  - `export` — the module export to mount (optional, default `mount`).
  - `contractVersion` — the mount-contract version the code was built against.
- resolution walks the type owner: instance → type → owner package (`source.file` → package root) → `meta.entry`.
  - no `manifest.json`, no id-strings, no central registry.
- discovery is a type-system query: the workspace's `projection` subtypes.
- at load the host validates the meta (`checkProjectionMeta`) and checks the version by STRICT EQUALITY
  against `MOUNT_CONTRACT_VERSION` (read the current value from the SDK source, never restate it in a doc).

The seam itself is a typed function each surface implements:

```ts
export type MountFn = (container: HTMLElement, host: MountHost) => () => void
```

- `container` — the DOM element to render into (any element: a pane, a window, a canvas node, a preview overlay).
- `host` — the capability surface (`MountHost`, below).
- the return value is the **unmount** disposer. Tear down every listener and empty the container.


## The kinds of projection

Projections form a KIND hierarchy, owned by this SDK.
Every mountable SURFACE is its own kind-typed subtype with its own locator.

- `projection` — the abstract base.
  - `pane-projection` — a full content surface (an editor, a file tree, a viewer). The common case.
  - `container-projection` — arranges child views by REFERENCE. Owns a layout dialect.
    - `grouping-container` — a tabbed / stacked group of children (the tabs container).
    - `spatial-container` — spatially placed children (bento's binary splits; a future canvas).
  - `bar-projection` — a linear aggregator (a status bar, a toolbar). Carries `order` / `minSize` / `overflowEligible`.
    - `status-projection` — a compact status role (`Ln, Col`; vault + daemon status).
  - `placeholder-projection` — what an empty slot resolves to.

Two rules make the set open and composable:
- **the role IS the kind.** A bar aggregates a role by querying `readSubtypes(kind)` — a status bar
  discovers every `status-projection` as a candidate. No hardcoded list.
- **NO container is privileged.** bento is one `container-projection` among several (tabs, bar, dock,
  a future canvas). A container owns ONLY its own layout dialect; the generic machinery (tabs, drag,
  re-parenting, focus-recency) is shared substrate every container composes.

A multi-surface component is N subtypes sharing ONE module via the locator `export`.
- the editor ships `editor-pane` (a `pane-projection`) + `editor-status` (a `status-projection`).
- both `meta` blocks point at the same `entry`; `editor-pane` uses the default `mount` export,
  `editor-status` names `export: status`.


## The composition model

A **composition** is how projection INSTANCES are arranged into a workspace.
It is where projections actually live on disk.

- a composition is its OWN type (`composition`), NOT a projection subtype. It does not mount; it ARRANGES.
- it is a normalized DOCUMENT:
  - `windows` — the OS windows the host opens on load. One is `primary` (the main window, surface 0).
  - `projections` — a flat POOL of records. Each carries a `^:` block-id and an explicit `type:`.
- the layout tree lives in the REFERENCE GRAPH, not in nesting:
  - a container names its children by REFERENCE (`[[^^id]]`) into the pool. It never embeds them.
  - so a re-parent is a reference re-point of two independent records. No parent ever re-serializes a stale child.
- the host owns the authoritative pool and is its single writer.
  - a record persists its own config via `host.saveConfig(next)`; the host merges it by id.
- a composition also carries workspace-scoped config: `intent-routing` (how views route intents to
  each other), `viewer-defaults` (which viewer opens each file kind), `keymaps`, and more.
- the host entry is ALWAYS a composition. Opening a single view is a composition whose one window's
  `content` names that view. So `instances_of(composition)` returns exactly the openable entries.

A minimal composition — a file tree beside an editor, split by bento:

```yaml
type: composition::au-host-sdk
windows:
  - "[[^^au-window-primary]]"
viewer-defaults:
  defaults:
    - opens: md
      viewer: "[[editor-pane::editor]]"
projections:
  # the main OS window; its content is the layout root, by reference
  - type: window::au-host-sdk
    primary: true
    content: "[[^^grid]]"
    ^: au-window-primary
  # a bento split (a spatial-container): tree on the left, doc on the right
  - ^: grid
    type: bento::bento
    root:
      type: bento-node.branch::bento
      direction: row
      ratio: 0.22
      children:
        - "[[^^tree]]"
        - "[[^^doc]]"
  # the two leaf views — each is one projection instance; its `type` names the view,
  # its other fields are that view's config
  - ^: tree
    type: file-tree::file-tree
  - ^: doc
    type: editor-pane::editor
```

Read `grid` → `tree` + `doc`: the container references its children, the children are flat pool
siblings. That reference graph IS the layout.


## How to use this

Consumed as **TypeScript source** — there is no build step.
Import from its subpath exports directly.

The surface, by subpath:

- `@arsumbris/au-host-sdk`
  - the mount contract: `MountHost`, `MountFn`, `ProjectionModule`, `defineProjection`.
  - the load-time gate: `checkProjectionMeta`, `MOUNT_CONTRACT_VERSION`.
  - the container substrate contract: `ContainerPlacement` + `deriveContainerSchemas` (below).
  - the observability substrate: `event` / `condition` / `on` (below).
  - the projection-side host adapter: `createMountHost` (for a surface that drives a proxied host).
- `@arsumbris/au-host-sdk/generated`
  - the codegen'd type interfaces (`Projection`, `PaneProjection`, `Composition`, `Window`,
    `ProjectionRuntimeMeta`, ...), generated from the base type-defs in `type/`.
  - re-exported from the main entry; import from here only if you want them in isolation.
- `@arsumbris/au-host-sdk/engine-reads`
  - the SOLE renderer-facing seam for the engine READ vocabulary.
  - a thin re-export of au-engine-sdk's renderer subpaths (`/reads` `/subscriptions` `/wikilink` `/wire`),
    so a projection names ONLY au-host-sdk and drops its direct au-engine-sdk dep.
- `@arsumbris/au-host-sdk/shared-deps`
  - the shared-dep externals contract: `SHARED_DEP_SPECIFIERS` + `sharedDepExternal`.
  - a projection's bundler externals this set so every bundle resolves to ONE host-served instance.

The base **type-defs** live in `type/` as engine vocabulary (not TypeScript):
- the `projection` base + its kind hierarchy (`pane-projection`, `container-projection`,
  `grouping-container`, `spatial-container`, `bar-projection`, `status-projection`, `placeholder-projection`).
- the arrangement types (`composition`, `window`, `mountable`, `composition-config`, `intent-routing`, ...).
- the metas a view attaches (`projection-runtime-meta`, `projection-presentation-meta`, and the
  intent metas `handles-intent-meta` / `fires-intent-meta` / `opens-meta`).

These are mounted in the engine's served workspace, so the daemon validates each projection instance's
config against its type-def, and codegen derives the TypeScript interfaces from them.


## The host capability surface

When the host mounts a projection, it passes a `MountHost`.
This is what a view reaches the rest of the system through.
Every member below is a property of the `host` argument to `mount(container, host)`.

- **config** — this view's own config, and how to persist it.
  - `host.config` (the instance config), `host.saveConfig(next)`, `host.onOwnConfigChange?(cb)`.
  - `host.entry.path` (the folder-repo the daemon entered on), `host.contractVersion`.
- **engine** — read and subscribe to the typed graph.
  - `host.engine.read({ read: 'lifecycle' })` → a `Promise<EngineReadResult>`.
  - `host.engine.subscribe({ subscribe: 'files' }, onEvent)` → an unsubscribe disposer.
  - channels: `lifecycle`, `files`, `changes`, `types`, `type_graph`, `link_graph`, `diagnostics`,
    `recent_commits`, and file `content`. The typed `Wire*` argument/result types come from `/engine-reads`.
- **files** — read/write vault files.
  - `host.files.read(path)`, `.write(path, content, expectedHash?)`, `.exists(path)`, `.delete(path)`, `.rename(from, to)`.
- **workspace** — the workspace shape (read-only here).
  - `host.workspace.members` (the member repos). MUTATING membership is an app-owned capability
    (`workspaceEdit` on `HostApp`, see `@arsumbris/au-host-app`), deliberately not on the mount contract.
- **styles** — the styling path for a view's CSS.
  - `host.styles.inject(css, root)` — a document-level `@scope`d sheet, CSP-exempt, returns a disposer.
  - a projection uses THIS, never a raw `<style>`. Thread the disposer on every unmount path.
- **overlay** — the one sanctioned way to draw ABOVE the composition.
  - `host.overlay?.claim({ level? })` → a layer `{ el, release() }` you draw into.
  - the host owns the stacking band + lifecycle; you own the content. Levels: `raised` `sticky`
    `dropdown` `overlay` `popover` `toast` `tooltip`. Never self-portal to `document.body`.
- **terminal** — host-owned pty sessions, keyed per pane.
  - `host.terminal.attach(opts?)` → a `TerminalSession`. A remount detaches + reattaches; it never kills the pty.
- **the view-state channels** — how views coordinate.
  - `intent` — fire a typed intent, or declare a capability. `host.intent.fire(payload)`;
    `host.intent.handle(type, { claim, commit })`. Routed intents dispatch to the focused capable
    handler (claim/decline, first claim wins); broadcast intents fan out to all.
  - `focus` — the active container per scope. `host.focus.report(activeView?)`, `.activePane?()`, `.watchActive?(cb)`.
  - `selection` — broadcast / follow what is picked. `host.selection.publish(value)`, `.follow(cb)`.
  - `viewState` — standing, tree-scoped state many views observe.
    `host.viewState.publish(slice, value)`, `.follow(publisher, slice, cb)`, `.watchAll(slice, cb)`.
- **viewStore** — restorable, per-machine LOCAL state (cursor, scroll, expansion).
  - `host.viewStore.get(subKey?)`, `.set(value, subKey?)`. Persisted outside the git-tracked composition.
- **closeGuard** — participate in the close/removal lifecycle.
  - `host.closeGuard?.register(guard)` — a guard returning `false` VETOES a close (e.g. unsaved work).
- **children / pool** (containers only) — mount and re-parent child views.
  - `host.children.mount(slot, child)`, and the `host.children.pool` record operations a container uses
    to place, group, float, and re-parent children. See the container substrate, below.

Two more surfaces a view can instrument:
- **observability** — the host event substrate, imported directly from `@arsumbris/au-host-sdk`.
  - `event(category, name, fields?)` records a temporal TRACE; `condition(name, severity, subject?, fields?)`
    raises a STANDING fact; `clearCondition(...)` clears it. Gate with `if (on(category))` so an off
    category allocates nothing. This is the standing dev-logging tool — instrument a decision point
    instead of a throwaway `console.log`.

Every member is present for a first-party view and a third-party plugin alike.
Optional members (marked `?`) may be absent depending on the site — guard them (`host.overlay?.claim()`).


## The container substrate

A container arranges children; it does not author their config.
The generic machinery is SHARED SUBSTRATE, split two ways:

- the framework-agnostic CONTRACT, in this SDK (from the main entry):
  - `ContainerPlacement` — the placement seam + extract/inject + the drop vocabulary.
  - `deriveContainerSchemas` — derives WHICH fields of a container hold its children, from the type
    graph. A container never DECLARES this; the shape says so, so a third-party container is enumerated
    without cooperating.
- the React paved-path IMPLEMENTATION, in a separate package (`container-kit`):
  - `TabGroup`, `PaneProjection`, the picker, focus-recency, the drag-and-drop protocol + drop router.

A container owns ONLY its layout dialect (bento: binary splits; tabs: a group; a future canvas: spatial
nodes). Everything else — tab bars, preview tabs, nav history, cross-container re-parenting — is substrate.


## How to extend this

You extend the UI by building PROJECTIONS and authoring COMPOSITIONS, not by changing the host.
- a projection is a package that speaks this SDK.
- you build it in your OWN repo, against the contracts here.
- the host discovers it as a type-system query and mounts it through the contract.


### Build a projection

A projection is TypeScript over this SDK, built to `dist/`.
The general flow:

**1. Declare the type-def** (`extends` a projection kind; `meta` declares the loadable code).

```yaml
# type/my-view.type.yaml — a pane view whose fields ARE its config
extends: pane-projection::au-host-sdk
fields:
  file?: String        # the instance IS the config; a saved composition reopens here
meta:
  - type: projection-presentation-meta::au-host-sdk
    title: My View
  - type: projection-runtime-meta::au-host-sdk
    entry: ./dist/index.js
    contractVersion: 7   # take this from the SDK source, never from a doc
```

**2. Declare the dependency** so the peer gate lets you CLAIM the base type.

```yaml
# .arsumbris/repo.yaml
deps:
  - name: au-host-sdk
```

**3. Implement the mount fn** and register the module.

```ts
// src/index.ts
import { defineProjection } from '@arsumbris/au-host-sdk'
import type { MountFn, ProjectionModule } from '@arsumbris/au-host-sdk'

const mount: MountFn = (container, host) => {
  const el = document.createElement('div')
  el.textContent = `entry: ${host.entry.path} (contract v${host.contractVersion})`
  container.appendChild(el)

  // read the graph through the host
  host.engine.read({ read: 'lifecycle' }).then((r) => { /* ... */ })

  return () => {
    // unmount: tear down listeners, empty the container
    container.replaceChildren()
  }
}

// `defineProjection` brands the module as the loader's registration gate; typing the contract
// (`ProjectionModule`) makes a missing / mis-shaped `mount` a COMPILE error. It is REQUIRED —
// a bare `export function mount` does not load.
export default defineProjection<ProjectionModule>({ mount })
```

**4. Build to `dist/`.** The host loads the built ESM, not source.

```
pnpm --filter "./projections/my-view" build
```

For live development, start the host with `AU_PROJECTION_DEV=1` and add `projectionLiveReload()` from `@arsumbris/au-host-sdk/build` to
the Vite configuration's `plugins`. Run the package's build in watch mode (`vite build --watch`),
mount the projection, and choose **Start live reload** in its pane actions. Each completed build
publishes an immutable output snapshot; the host imports the new module graph and remounts the
selected instance. Live reload is off by default, independently of the member's editable role.
Watch opt-in lasts for that mount in its window; re-enable after moving it. Source edits require a successful build. This is a remount, so projections must
dispose listeners and styles and use host-owned storage for state that should survive replacement.

**Reload projection** imports a fresh snapshot of the current built output on demand. Import or
export-validation failures leave the current view mounted; close guards can refuse replacement.
Container chrome can offer these actions through the optional `host.projections` capability:
`status(paneId)`, `reload(paneId)`, and `setWatching(paneId, enabled)`.

**5. Author an instance** — inside a COMPOSITION (see the composition model above). A projection
instance is one pool record; its `type` names the view, its other fields are that view's config:

```yaml
  - ^: my-doc
    type: my-view::my-repo
    file: notes/today.md
```


### Build a container projection

A container extends `container-projection` (or `grouping-container` / `spatial-container`) and owns a
layout dialect. Its fields hold its children BY REFERENCE.

```yaml
# type/my-stack.type.yaml — a vertical stack of children
extends: container-projection::au-host-sdk
fields:
  children: mountable::au-host-sdk*[]   # references into the composition pool
meta:
  - type: projection-runtime-meta::au-host-sdk
    entry: ./dist/index.js
    contractVersion: 7
```

- mount children via `host.children.mount(slot, child)`; place / re-parent them via `host.children.pool`.
- use `deriveContainerSchemas` + the `container-kit` paved path for tabs, drag, and focus-recency
  instead of re-implementing them.


### Build a multi-surface projection

Ship N subtypes that share ONE module via the locator `export`.

```yaml
# type/editor-pane.type.yaml — the default `mount` export
extends: pane-projection::au-host-sdk
meta:
  - type: projection-runtime-meta::au-host-sdk
    entry: ./dist/index.js
    contractVersion: 7
```
```yaml
# type/editor-status.type.yaml — the same entry, a different export
extends: status-projection::au-host-sdk
meta:
  - type: projection-runtime-meta::au-host-sdk
    entry: ./dist/index.js
    export: status
    contractVersion: 7
```
```ts
// src/index.ts — one module, two surfaces
export default defineProjection<ProjectionModule>({ mount, status })
```


### Codegen

The base interfaces are GENERATED from the type-defs — never hand-maintained.
- `gen:types` reads the base type-defs over a served workspace and writes `src/generated.ts`.
- consumers import the generated interfaces (`Projection`, `Composition`, `ProjectionRuntimeMeta`, ...)
  from `@arsumbris/au-host-sdk`; a projection that owns its own config type-defs generates its own.


## Pointers

- the `hello` fixture — the canonical minimal projection (TypeScript over this SDK, built to `dist/`).
  Read it to see the whole contract path in one file.
