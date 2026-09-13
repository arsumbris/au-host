# `@arsumbris/au-host-app`

The **app-owned capability tier**. `HostApp` is `MountHost` plus the capabilities that operate on
the application itself: the engine daemon, the agent (mcp) daemon, workspace membership, and file
scope.

## Which tier does a capability belong to?

> **Read the workspace shape → the contract. Mutate it, or drive the app → app-owned.**

Already encoded twice, as deliberate pairs:

| read (on `MountHost`) | mutate (on `HostApp`) |
|---|---|
| `workspace.members` | `workspaceEdit` |
| `engine.readIgnores` | `scope` |

One-sentence test: *could a third-party projection hold this, safely, forever?* Yes → contract.

## Why this is not in `@arsumbris/au-host-sdk`

The mount contract is framework-agnostic and knows no app vocabulary. These controls speak in
daemon statuses, agent governance and skill manifests — none of which the projection mount contract
should be able to name. Putting them there would make every cross-repo projection carry vocabulary
it will never use.

Same rule that keeps `range` / `selection` / `intent` in their own packages.

## Why it is not in `app/src` either

A projection cannot import from the app, and no projection does. Before this package, four
projections hand-rolled the slice they needed:

```ts
interface MountHostX extends MountHost {
  readonly daemon: DaemonControl   // a hand-copy, free to drift
}
```

This package is the one definition. `app/src/shared/daemon-api.ts` re-exports from here, so main
and preload are unchanged and no second copy exists.

## It is not an enforcement boundary

`makeMountHost()` returns a `HostApp`, and every projection is mounted with that one object — so a
projection that casts reaches `daemon` whatever it declares. That is deliberate: the trust boundary
is the **agent bridge**, and a projection is code the user chose to install. This tier buys API
clarity, not a sandbox.

Whether it should *also* be enforced is open, and tracked.

## Usage

```ts
import type { HostApp } from '@arsumbris/au-host-app'

export function mount(el: HTMLElement, host: HostApp): () => void {
  void host.daemon.status()   // app-owned
  void host.workspace.members // contract, inherited
  return () => {}
}
```

A projection needing only the contract keeps importing `MountHost` from `@arsumbris/au-host-sdk` and
does not depend on this package at all.
