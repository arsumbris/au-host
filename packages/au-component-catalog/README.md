---
type: au.engine.readme::au-engine
tldr: The interface catalog for the host's `<au-*>` components — the component names as `ui-component` type-defs (fields are the props) plus their codegen'd consumer types and React wrappers. A consumer depends on this catalog, never on an implementation set.
---

# Repo Overview

## General Context

- `arsumbris` is a framework for agentic knowledge work.
- `au-engine` serves a graph over a cross-repo substrate of typed files.
- `au-host` is the UI layer — an Electron shell that mounts views over that graph.

`au-component-catalog` is part of `au-host`. It is the interface catalog for the `<au-*>` set.

## What this is

`au-component-catalog` is the **interface catalog** for the host's components.

## Component contracts
- one `ui-component` type-def per tag (`type/<tag>.type.yaml`). Its name IS the tag; its FIELDS are the
  props. A `ui-component-meta` block carries the events, slots, states, parts, and a preview snippet.
- from these, codegen derives the typed consumer surface: the props types (`src/generated.ts`) and the
  React wrappers (`src/react.ts`).
- this package ships **no implementation runtime** — only type-defs and their generated types. A
  consuming projection depends on the catalog (the names + typed props), never on a component SET.
- an implementation set (`@arsumbris/au-component-set`) IMPLEMENTS these names; the catalog DECLARES
  them. That split is what lets a set be swapped without touching a consumer.

## How to use this

Consumed as TypeScript source.

- a consuming projection imports the typed props and React wrappers from the catalog:

```tsx
import { AuButton, AuBadge } from '@arsumbris/au-component-catalog/react'

<AuButton variant="primary" onAuActivate={save}>Save</AuButton>
<AuBadge variant="count">12</AuBadge>
```

- the subpaths: `@arsumbris/au-component-catalog` (the codegen'd prop types), `.../react` (the generated
  `<AuXxx>` wrappers), plus theming + support modules (`.../theme-library`, `.../theme-preview`, ...).
## How to extend this

Declare the component interface and implement it in the component set.

**1. Declare the interface** — a `ui-component` type-def whose fields ARE the props:

```yaml
# type/au-badge.type.yaml — the name is the tag, fields are the props
extends: ui-component::component-contract
fields:
  variant?: [label, count, dot]   # enum; the first value is the gallery's sample
  tone?: [ink, ok, warn, danger]
meta:
  - type: ui-component-meta::component-contract
    slots: [default]
    states: [variant, tone]
    parts: [badge]
    preview: '<au-badge variant="count">12</au-badge> <au-badge tone="ok">Ready</au-badge>'
```

**2. Regenerate consumer types and wrappers.**

Run the package's `gen:types` and `gen:react` scripts with a workspace containing its type dependencies, then typecheck affected consumers.

The implementing element lives in `@arsumbris/au-component-set` (`src/<tag>.ts`).
