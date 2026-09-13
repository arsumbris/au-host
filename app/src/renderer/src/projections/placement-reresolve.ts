// The re-resolve-after-await invariant for chooser-suspending placement routines.
//
// A placement routine that suspends on an async chooser (a wrap-kind pick, a pane pick) MUST re-read the
// pool state it is about to mutate AFTER the suspension. The pool can move during the await — a concurrent
// move re-points a window's content — so building edits from a value captured BEFORE the await wraps a now-
// stale id and strands the concurrent move's subtree.
//
// This combinator makes the invariant structural: it awaits `pick`, and only THEN calls `resolve` for a
// FRESH target, so a caller that uses the returned `target` cannot build from a pre-await read. Both the
// main-window (`placeIntoMainLeaf`) and secondary-window (`injectOccupantIntoSecondaryRoot`) routines route
// their post-pick resolution through here.
//
// `pick` yields its choice or the literal 'cancel'; `resolve` re-reads the mutation target, or null if it
// vanished or changed to an unusable state during the pick. The result is the pick plus the fresh target,
// or a sentinel the caller maps to its own abort: 'cancel' (the user dismissed the chooser) or
// 'resolve-miss' (the target moved during the pick — abort with a trace, never mutate from the stale read).

export type PickThenResolve<P, T> = { pick: P; target: T } | 'cancel' | 'resolve-miss'

export async function pickThenResolve<P, T>(
  pick: () => Promise<P | 'cancel'>,
  resolve: () => T | null,
): Promise<PickThenResolve<P, T>> {
  const picked = await pick()
  if (picked === 'cancel') return 'cancel'
  const target = resolve() // FRESH read — happens strictly after the pick resolves, never before it.
  if (target === null) return 'resolve-miss'
  return { pick: picked, target }
}
