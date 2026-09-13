import type {
  BranchNode,
  DropZone,
  LayoutNode,
  LeafNode,
  PaneId,
} from './types';

// bento's node model is `leaf | branch` only. A "tabbed pane" is a
// leaf whose `content` is a `tabs` CONTAINER instance (a peer projection); bento owns
// no tab knowledge. Tab wrap/reorder/activate live in the `tabs` container + the shared
// router (container-core), never here.

/** Id generator for branches and any host-side leaves. Each session gets a random
 *  prefix so ids generated this run cannot collide with persisted ids from a previous
 *  run loaded via workspace YAML. Leaf pane ids supplied by the caller are unaffected. */
let _session: string = randomSession();
let _nextId = 1;

export function genId(): string {
  return `bento-${_session}-${_nextId++}`;
}

/** Reset the id state — tests only. Pins the session prefix to `test`. */
export function _resetIdsForTests(): void {
  _session = 'test';
  _nextId = 1;
}

function randomSession(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/** Generic tree transform. `fn` is called on every node top-down; return a new node to
 *  replace, the same node to recurse into children, or null to prune. */
export function walkTree<P>(
  node: LayoutNode<P>,
  fn: (n: LayoutNode<P>) => LayoutNode<P> | null,
): LayoutNode<P> | null {
  const result = fn(node);
  if (result !== node) return result;
  if (node.type === 'leaf') return node;
  const newFirst = walkTree(node.children[0], fn);
  const newSecond = walkTree(node.children[1], fn);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  if (newFirst === node.children[0] && newSecond === node.children[1]) return node;
  return { ...node, children: [newFirst, newSecond] };
}

/** Find a leaf by pane id. */
export function findLeaf<P>(node: LayoutNode<P>, paneId: PaneId): LeafNode<P> | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null;
  return findLeaf(node.children[0], paneId) ?? findLeaf(node.children[1], paneId);
}

/** Find ANY node by id — a leaf or a branch. Returns the enclosing branch too, so
 *  promote/detach can target a whole sub-layout, not just a pane. */
export function findNodeById<P>(node: LayoutNode<P>, id: string): LayoutNode<P> | null {
  if (node.id === id) return node;
  if (node.type === 'leaf') return null;
  return findNodeById(node.children[0], id) ?? findNodeById(node.children[1], id);
}

/** The node and every enclosing node up to the root, leaf-first / root-last.
 *  Empty when `paneId` is absent. The promote/detach target picker walks this. */
export function findAncestry<P>(root: LayoutNode<P>, paneId: PaneId): LayoutNode<P>[] {
  const path: LayoutNode<P>[] = [];
  function walk(node: LayoutNode<P>): boolean {
    if (node.type === 'leaf') {
      if (node.id !== paneId) return false;
      path.push(node);
      return true;
    }
    if (walk(node.children[0]) || walk(node.children[1])) {
      path.push(node);
      return true;
    }
    return false;
  }
  walk(root);
  return path;
}

/** Replace the node with `id` by `replacement`, preserving tree structure. */
export function replaceSubtree<P>(
  root: LayoutNode<P>,
  id: string,
  replacement: LayoutNode<P>,
): LayoutNode<P> {
  if (root.id === id) return replacement;
  if (root.type === 'leaf') return root;
  return {
    ...root,
    children: [
      replaceSubtree(root.children[0], id, replacement),
      replaceSubtree(root.children[1], id, replacement),
    ],
  };
}

/** Deep-clone a subtree with fresh ids throughout, returning the clone and the
 *  old→new id map. Detach uses this so the inlined copy is a NEW independent subtree. */
export function reidSubtree<P>(node: LayoutNode<P>): { node: LayoutNode<P>; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  function clone(n: LayoutNode<P>): LayoutNode<P> {
    const newId = genId();
    idMap.set(n.id, newId);
    if (n.type === 'leaf') return { ...n, id: newId };
    return { ...n, id: newId, children: [clone(n.children[0]), clone(n.children[1])] };
  }
  return { node: clone(node), idMap };
}

/** Every leaf in the tree. */
export function getAllLeaves<P>(node: LayoutNode<P>): LeafNode<P>[] {
  if (node.type === 'leaf') return [node];
  return [...getAllLeaves(node.children[0]), ...getAllLeaves(node.children[1])];
}

/** Split a target pane along an edge zone, inserting `newLeaf`. A `center` zone has no
 *  meaning in bento (no tabs) — the shared router intercepts a center drop UPSTREAM and
 *  wraps it into a `tabs` container, so `center` never reaches here; guarded as a no-op. */
export function splitPane<P>(
  root: LayoutNode<P>,
  targetPaneId: PaneId,
  newLeaf: LayoutNode<P>,
  zone: DropZone,
): LayoutNode<P> {
  if (zone === 'center') return root;
  return splitWithNode(root, targetPaneId, newLeaf, zone);
}

/** Geometric split inserting an arbitrary subtree (leaf or branch) as a sibling of the
 *  target along an edge zone. */
export function splitWithNode<P>(
  root: LayoutNode<P>,
  targetPaneId: PaneId,
  incoming: LayoutNode<P>,
  zone: Exclude<DropZone, 'center'>,
): LayoutNode<P> {
  const direction: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const newFirst = zone === 'left' || zone === 'top';

  function walk(node: LayoutNode<P>): LayoutNode<P> {
    if (node.type === 'leaf') {
      if (node.id !== targetPaneId) return node;
      return makeBranch(node, incoming, direction, newFirst);
    }
    return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
  }
  return walk(root);
}

function makeBranch<P>(
  existing: LayoutNode<P>,
  incoming: LayoutNode<P>,
  direction: 'row' | 'column',
  incomingFirst: boolean,
): BranchNode<P> {
  return {
    type: 'branch',
    id: genId(),
    direction,
    ratio: 0.5,
    children: incomingFirst ? [incoming, existing] : [existing, incoming],
  };
}

/** Remove a pane. Auto-collapses single-child branches. Returns null when the tree
 *  becomes empty (removed the only pane). */
export function removePane<P>(
  root: LayoutNode<P>,
  targetPaneId: PaneId,
): LayoutNode<P> | null {
  if (root.type === 'leaf') return root.id === targetPaneId ? null : root;
  const [first, second] = root.children;
  const newFirst = removePane(first, targetPaneId);
  const newSecond = removePane(second, targetPaneId);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  if (newFirst === first && newSecond === second) return root;
  return { ...root, children: [newFirst, newSecond] };
}

/** Resize a branch by id. Ratio clamps to [0.1, 0.9]. No-op if branch not found. */
export function resizeBranch<P>(
  root: LayoutNode<P>,
  branchId: string,
  newRatio: number,
): LayoutNode<P> {
  const clamped = Math.max(0.1, Math.min(0.9, newRatio));
  function walk(node: LayoutNode<P>): LayoutNode<P> {
    if (node.type === 'leaf') return node;
    if (node.id === branchId) return { ...node, ratio: clamped };
    return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
  }
  return walk(root);
}

/** Update a leaf's state. No-op if leaf not found. */
export function updateLeafState<P>(
  root: LayoutNode<P>,
  paneId: PaneId,
  updater: (state: P) => P,
): LayoutNode<P> {
  function walk(node: LayoutNode<P>): LayoutNode<P> {
    if (node.type === 'leaf') {
      if (node.id !== paneId) return node;
      return { ...node, state: updater(node.state) };
    }
    return { ...node, children: [walk(node.children[0]), walk(node.children[1])] };
  }
  return walk(root);
}

/** Move a pane: remove from its current position, then split onto the target along an
 *  edge zone. Returns the input unchanged on degenerate requests (source-onto-self,
 *  target-not-found — no move, no loss). A `center` zone is handled by the shared router
 *  (wrap into a `tabs` container) UPSTREAM, so it never reaches here. */
export function movePane<P>(
  root: LayoutNode<P>,
  sourcePaneId: PaneId,
  targetPaneId: PaneId,
  zone: DropZone,
): LayoutNode<P> {
  const sourceLeaf = findLeaf(root, sourcePaneId);
  if (!sourceLeaf) return root;
  if (sourcePaneId === targetPaneId) return root; // onto self — nothing to do
  if (zone === 'center') return root; // center is the router's wrap-into-tabs, not a bento move
  const withoutSource = removePane(root, sourcePaneId);
  if (!withoutSource) return root;
  if (!findLeaf(withoutSource, targetPaneId)) return root; // target gone — no move, no loss
  return splitWithNode(withoutSource, targetPaneId, sourceLeaf, zone);
}
