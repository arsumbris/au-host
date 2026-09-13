/** Unique pane identifier. */
export type PaneId = string;

/** Drop zones the host can request for split/tab operations. */
export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** A node in the bento layout tree — either a leaf or a binary branch.
 *  Parametric over the app-defined per-leaf state type. A "tabbed pane" is a leaf
 *  whose `content` is a `tabs` CONTAINER instance (a peer projection); bento owns
 *  no tab knowledge. */
export type LayoutNode<PaneState> =
  | LeafNode<PaneState>
  | BranchNode<PaneState>;

/** A leaf in the bento tree — carries one opaque per-leaf payload (`state`)
 *  that bento never inspects. BentoApp instantiates this with its own
 *  `PaneState` payload; the host's `renderUnit` callback handles the
 *  paneType / config dispatch. */
export interface LeafNode<PaneState> {
  type: 'leaf';
  id: PaneId;
  state: PaneState;
}

/** A binary split. `ratio` is the first child's flex share (0.1–0.9 after clamp). */
export interface BranchNode<PaneState> {
  type: 'branch';
  id: string;
  direction: 'row' | 'column';
  ratio: number;
  children: [LayoutNode<PaneState>, LayoutNode<PaneState>];
}

/** The full persistable layout state. */
export interface LayoutState<PaneState> {
  root: LayoutNode<PaneState> | null;
}
