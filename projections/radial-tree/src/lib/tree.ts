/**
 * The neutral rooted tree the radial layout consumes.
 *
 * Framework-free and source-agnostic: it knows nothing of MOCs, the engine, or
 * React. A `radial-tree` projection builds one of these from a `neighborhood`
 * read (a graph → a spanning tree); the layout takes it from there.
 *
 * `data` is an opaque passthrough for render metadata the layout does not
 * interpret (an edge `kind`, a `file_kind`, a byte count). It rides onto the
 * positioned node untouched.
 */
export interface TreeNode<D = unknown> {
  /** Stable identity (a file path, a slug, any unique key). */
  id: string
  /** Human label. */
  label: string
  /** Deeper nodes. A node with no children is a leaf. */
  children: TreeNode<D>[]
  /** Opaque render metadata, carried through to the positioned node. */
  data?: D
}

/**
 * Recursive subtree weight: the sum of child weights, floored at 1.
 * A leaf weighs 1. Weight drives each subtree's angular allocation, so a
 * bushy branch claims proportionally more of the circle.
 */
export function subtreeWeight<D>(node: TreeNode<D>): number {
  const childWeight = node.children.reduce((sum, c) => sum + subtreeWeight(c), 0)
  return Math.max(childWeight, 1)
}

/** A node with no children. */
export function isLeaf<D>(node: TreeNode<D>): boolean {
  return node.children.length === 0
}
