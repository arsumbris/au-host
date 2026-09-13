// Bento window-manager projection. Mounts a resizable layout whose panes contain child projections.

import { createRoot } from 'react-dom/client'
import { defineProjection, type GroupBuildFn, type GroupingContainerModule, type MountHost } from '@arsumbris/au-host-sdk'

import { BentoApp } from './BentoApp'
import type { Bento, BentoNodeBranch } from './generated'

function mount(container: HTMLElement, host: MountHost): () => void {
  const root = createRoot(container)
  root.render(<BentoApp host={host} />)
  return () => root.unmount()
}

/** Build a right-leaning spine of binary splits from the (already `^:`-tagged) child records — one branch
 *  for the wrap case (2 children), nesting for N>2 (arity is not yet expressible; bento's own convention is
 *  2 per branch). The embedded children are cast to the branch's `Ref` union: `createGroup`'s
 *  `normalizeToPool` flattens them into pool records and rewrites them as `[[^^id]]` references, so the
 *  ON-DISK form is reference-only (valid) while the transient build output embeds. Same contract as column's
 *  `buildGroup`. `direction: row`, even `ratio` — the neutral default for a fresh split. */
function buildBranch(kids: Array<Record<string, unknown>>): BentoNodeBranch {
  const children = (kids.length <= 2 ? kids : [kids[0], buildBranch(kids.slice(1))]) as unknown as BentoNodeBranch['children']
  return { type: 'bento-node.branch', direction: 'row', ratio: 0.5, children }
}

/**
 * The `spatial-container` module contract's build export: mint a bento (a split) holding the children, each
 * child's stable id landing as its `^:`. bento is the "Arrange" family's wrap target — the SUBSTRATE calls
 * this; it never authors bento's schema. The substrate is DECOUPLED from the drop's grouping kind, so this
 * never changes center-drop-onto-bento (which still wraps into a stack group).
 */
const buildGroup: GroupBuildFn<Bento> = (children) => {
  const embedded = children.map((c) => ({ '^': c.id, ...(c.instance as Record<string, unknown>) }))
  // A SINGLE-child wrap (the "wrap in a container holding only itself" affordance) must NOT mint a
  // degenerate one-child branch — bento is a SPATIAL split container, and a branch with one child
  // renders empty (it drops the child's subtree). The bento's `root` is itself the child-position union,
  // so a lone child lands as a BARE-LEAF root (`root: <the child>`), which bento renders directly.
  // Two-plus children mint a real split branch. (A stack container like column has no such floor.)
  const root = embedded.length === 1 ? embedded[0] : buildBranch(embedded)
  return { type: 'bento', root: root as Bento['root'] }
}

/** The mount export (the locator's `export`, default `mount`) + the `buildGroup` group-build (the
 *  spatial-container module contract). `GroupingContainerModule<Bento>` makes a missing / mis-shaped
 *  surface a COMPILE error. */
export default defineProjection<GroupingContainerModule<Bento>>({ mount, buildGroup })
