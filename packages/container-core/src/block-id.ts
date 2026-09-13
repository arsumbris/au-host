/**
 * Mint block ids for in-memory records created by the substrate. The engine's assign_block_id
 * operates on a persisted file and byte offset, which are unavailable at this point.
 *
 * A session prefix and monotonic counter avoid collisions without inspecting the full document.
 * This function does not prove uniqueness; the engine reports block-id-duplicate at validation.
 */

/** A per-session prefix, so an id minted this run cannot collide with one persisted by a previous
 *  run and loaded from a composition file. */
let session = randomSession();
let next = 1;

function randomSession(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Mint a fresh block-id for a record the substrate is synthesizing. */
export function mintBlockId(): string {
  return `wrap-${session}-${next++}`;
}

/** Reset the id state — TESTS ONLY. Pins the session prefix so output is assertable. */
export function _resetBlockIdsForTests(): void {
  session = 'test';
  next = 1;
}
