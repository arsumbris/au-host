# au-host

The host application of the **Ars Umbris** workspace.
An Electron shell that mounts composable UI over the engine's typed graph.

## General context

`au-host` is one part of the `arsumbris` framework.

- `arsumbris` is a framework for agentic knowledge work.
- `au-engine` serves a graph over a cross-repo substrate of typed files.
- `au-host` is the UI layer — an Electron shell that mounts views over that graph.
- `au-mcp` is the agent layer.

## What au-host is

au-host is the shell that composes UI on top of the engine.

- it owns the **loader and mount machinery** that brings views to life,
- and the **layout slots** those views mount into.

The unit of composable UI is a **projection**:
a view that slots into the host and composes through one contract.
First-party views, third-party plugins, and end-user custom builds all mount over the same contract.
That moldability is the point — the host is a framework for building UI on the engine,
not a fixed app.

The host is NOT the projections.
Projections are their own packages and speak the host SDK.

## Repository status

au-host is currently a **monorepo**:
the shell, the SDKs, the shared packages, and the first-party projections all live here together.
This will soon be **split**.
The projections and shared packages extract into their own packages,
talking to the shell only through `@arsumbris/au-host-sdk`.
The contract is already the seam; the repository layout is what changes.

## The layers

- **`app/`** — the Electron shell.
  - `app/src/main` (daemon supervision, windows, terminal pty)
  - `app/src/preload` (the bridge),
  - `app/src/renderer` (the projection runtime + the root app).
- **`packages/`** — the SDKs, vocabulary, and style.
  - **`au-host-sdk`** — the projection **mount contract**. The base types a view extends, the
    composition document, and the capability surface a view receives. → see its README to build a projection.
  - **`au-host-app`** — the app-owned capability tier (`HostApp` = the mount contract plus the
    capabilities that drive the app itself: the daemon, workspace edits, scope).
  - **`range` / `selection` / `intent`** — substrate vocabulary the SDK never interprets.
  - **`style`** — the design tokens, rendered as CSS variables the host injects.
  - **`type-query`** — the typed-instances filter model (standin for actual queries; comming soon).
  - **`preview-content`** - preview builders
  - **`container-core` / `container-kit`** — the shared container substrate (the placement contract)
    and its React paved-path implementation (tabs, drag-and-drop, re-parenting).
  - **`au-component-set` / `au-component-catalog`** — the `<au-*>` web-component set and its live gallery.
  - **`au-host-launcher`** — the pre-composition launcher (pick a workspace, set it up, start the engine).
- **`projections/`** — the first-party projections.
  - the editor, file tree, bento, dock, bar, diagnostics, backlinks, type explorer, terminal,
    daemon control, notifications, and more, plus the `hello` fixture (the canonical minimal projection).

## Relationship to the engine

au-host is one consumer of the `au` engine daemon.

- the host does NOT ship the engine. You point the host's gate UI at an `au` binary.
- it talks to the daemon through `@arsumbris/au-engine-sdk`.
- the framework's three contract SDKs are peers: `au-engine-sdk` (the engine client),
  `au-host-sdk` (the UI mount contract), and `au-mcp-sdk` (the agent kernel contract).

## Running and building

`pnpm` workspaces. TypeScript, React, electron-vite.

```
pnpm dev                              # run the Electron shell (live)
pnpm -r build                         # build all workspace packages
pnpm --filter "./projections/*" build # rebuild projections after editing them
pnpm -r typecheck                     # typecheck
```

The dev loop has one gotcha worth knowing up front: **projections run from their built `dist/`**, not
from source. `pnpm dev` serves the shell live, but after editing a projection you must rebuild it and
reload before the change shows.
(Hot reload comming soon).

To run against a workspace, point the host's daemon gate at a workspace folder (a folder carrying
`.arsumbris/repo.yaml`); the host supervises the `au` daemon over it.

## Building a projection

Start from **[`packages/au-host-sdk`](packages/au-host-sdk/README.md)** — it covers the projection
kinds, the composition model, the capability surface, and a worked walkthrough. The `hello` package
is the canonical minimal example, and ships an agent-facing how-to skill beside it.
