---
type: au.engine.readme::au-engine
tldr: The first-party default `<au-*>` component set — Lit shadow-DOM custom elements, token-only, the immovable floor of the host's component-resolution stack. It implements the names the au-component-catalog declares. Use it by letting the host register it at boot and writing `<au-*>` tags in your view. Extend it by authoring a new element against a coherent design, with its catalog type-def.
---

# Repo Overview

## General Context

- `arsumbris` is a framework for agentic knowledge work.
- `au-engine` serves a graph over a cross-repo substrate of typed files.
- `au-host` is the UI layer — an Electron shell that mounts views over that graph.

`au-component-set` is part of `au-host`. It is the default UI component set every view draws from.

## What this is

`au-component-set` is the **first-party default `<au-*>` component set**.

- the elements are **Lit custom elements** — shadow-DOM, token-only (they style themselves from the
  host's design tokens, never from ambient page CSS).
- it is the **floor** of the host's component-resolution stack (`default-set`): the always-present set
  a view falls back to when no other set overrides a tag.
- it IMPLEMENTS the component NAMES declared by `@arsumbris/au-component-catalog`. The catalog owns the
  interface (the tag name + its props); this package owns the behaviour (the Lit element).

The set never touches `customElements` itself.
- it does NOT call `customElements.define`, and does NOT self-register on import.
- its single entry export is `register(api)`. It hands the host raw element classes via `api.define`,
  and the HOST chooses the target registry (the global one at boot; a per-set scoped registry for the
  gallery preview).
- that indirection is the seam that makes component discovery, selection, and set-swapping possible.

The set ships ~85 elements, across the usual families:
- **atoms** — `au-button`, `au-icon`, `au-icon-button`, `au-badge`, `au-chip`, `au-tag`, `au-pill`,
  `au-kbd`, `au-spinner`, `au-skeleton`, `au-divider`, `au-meter`, `au-status-dot`.
- **inputs** — `au-input`, `au-textarea`, `au-number-input`, `au-select`, `au-combobox`, `au-checkbox`,
  `au-switch`, `au-radio-group`, `au-field`, `au-segmented-control`, `au-slider`, `au-color-picker`,
  `au-chord-input`, `au-typed-value-editor`.
- **surfaces + layout** — `au-card`, `au-pane-frame`, `au-pane-header`, `au-splitter`, `au-scroll-area`,
  `au-drawer`, `au-modal`, `au-accordion`, `au-section-header`, `au-toolbar`, `au-drop-zone`.
- **navigation** — `au-nav-item`, `au-nav-group`, `au-tree`, `au-breadcrumb`, `au-tabs`, `au-tab-bar`,
  `au-menu`, `au-command-palette`, `au-pagination`, `au-stepper`, `au-list-row`, `au-viewer-switch`.
- **feedback + overlay** — `au-toast`, `au-banner`, `au-tooltip`, `au-popover`, `au-hovercard`,
  `au-empty-state`, `au-output-log`.
- **data + code** — `au-table` (+ its cell parts), `au-code-block`, `au-code-sample`, `au-diff-line`.

## How to use this

Consumed as a **built bundle**. The host loads the set's `dist/index.js`, never source.

- the host locates the set via its type-def's runtime meta (`entry: ./dist/index.js`) and calls its
  `register(api)` at boot, defining every `<au-*>` tag into the global custom-element registry.
- a projection then just writes the tag in its DOM:

```html
<au-button variant="primary">Save</au-button>
<au-badge variant="count">12</au-badge>
```

- from **React**, use the generated `<AuXxx>` wrappers from `@arsumbris/au-component-catalog/react`
  rather than the raw intrinsic tag — a dashed attribute and custom events do not wire reliably through
  React on an intrinsic custom element:

```tsx
import { AuButton } from '@arsumbris/au-component-catalog/react'
<AuButton variant="primary" onAuActivate={save}>Save</AuButton>
```

Rebuild the set after editing an element (the host runs the built bundle, not source):

```
pnpm --filter @arsumbris/au-component-set build
```

## How to extend this

Keep component interfaces, implementations and consumer types consistent when making changes.

A component is **an interface and implementation across two packages**, which the host wires together:
- the **interface** — a `ui-component` type-def in `au-component-catalog` (`type/<tag>.type.yaml`). Its
  name is the tag; its fields are the props. Drives discovery + codegen. Set-independent.
- the **behaviour** — a Lit element here (`src/<tag>.ts`): shadow-DOM, token-only.


The flow for a new element:
1. author the interface type-def in `au-component-catalog` (`type/<tag>.type.yaml`).
2. write the Lit element here as `src/<tag>.ts`.

```ts
// src/au-badge.ts — a Lit element: static properties, token-only shadow styles, a render()
import { css, html, nothing } from 'lit'
import { AuElement } from './au-element'

export class AuBadgeElement extends AuElement {
  static properties = {
    variant: { type: String, reflect: true },
    tone: { type: String, reflect: true },
  }
  declare variant?: 'label' | 'count' | 'dot'
  declare tone?: 'ink' | 'ok' | 'warn' | 'danger'

  static styles = css`
    :host { display: inline-flex; }
    .badge { /* token-only shadow CSS, e.g. background: var(--au-color-surface-2) */ }
  `
  render() {
    return html`<span class="badge" part="badge">${this.variant === 'dot' ? nothing : html`<slot></slot>`}</span>`
  }
}
```

3. register it: add `api.define('au-badge', AuBadgeElement)` to `src/index.ts`, and add the tag to the
   `provides` list in `type/default-set.type.yaml`.
4. Build the set and affected consumers before testing — the host runs the built bundles.
