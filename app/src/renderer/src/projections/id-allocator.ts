/**
 * GRANTED ID-RANGES — the authority mints identity, a surface draws it synchronously.
 *
 * The composition is ONE typed graph the authority owns; every pool record's `^:` is an identity in
 * that one pool, and the authority is its sole minter. But a container draws an id SYNCHRONOUSLY in the
 * middle of a gesture (`registry.ts` drop → createRecord → wrap → commit), and a secondary window's
 * mint would be an IPC round-trip — async, breaking the gesture. So the authority does not mint per
 * draw: it GRANTS each surface a BLOCK of ids up front, the surface draws from its block synchronously
 * (a final id, never renamed), and refills the block asynchronously ahead of need. Identity stays the
 * authority's (it granted every block); the create seam stays synchronous (a draw never waits).
 *
 * DISJOINT BY CONSTRUCTION. The one authority allocator hands out blocks off a single monotonic
 * counter, so no two blocks — on any surface — ever overlap. The per-block prefix carries that counter
 * plus the surface id, so a drawn id is unique across every window without coordination.
 *
 * SESSION-SCOPED, so a fresh run never collides with a PERSISTED id. A created record's id is saved in
 * the composition; on reopen the allocator starts its block counter at 0 again, so without a
 * per-session token it would re-draw the same `s0b0-0` and collide with last run's persisted records.
 * The random session prefix makes a new run's ids disjoint from every prior run's, the same guarantee
 * `container-core/block-id.ts` gives for its synthesized-group ids.
 *
 * BIRTH-PROVENANCE, NOT LOCATION. The prefix records WHERE AN ID WAS BORN (which surface drew it, in
 * which block), never where the record lives NOW. A cross-window move is a parent RE-POINT; the id is
 * untouched. Current window is read from the pool topology (which window node is the record's
 * ancestor), NEVER by parsing the id. Nothing may parse the prefix to infer the current owner.
 *
 *
 * The authority owns pool identities and grants ranges to remote surfaces. Containers never mint them.
 */

/** A granted block of ids: a unique prefix plus how many ids it holds. Ids drawn are
 *  `` `${prefix}-${index}` `` for `index` in `[0, size)`. */
export interface IdBlock {
  readonly prefix: string
  readonly size: number
}

/**
 * How a surface asks the authority for another block. In-process (surface 0, co-located) it resolves
 *  synchronously to a local grant; over IPC (a secondary surface) it resolves asynchronously.
 */
export type BlockRequest = () => IdBlock | Promise<IdBlock>

/** Default block size. Far larger than any realistic per-gesture draw (~1-3), so a gesture never runs a
 *  block dry between watermark refills. */
export const DEFAULT_BLOCK_SIZE = 1024
/** Refill when the range's remaining count falls below this. Must be >= the worst-case per-gesture draw,
 *  so the reserve never under-runs a single gesture mid-flight. */
export const DEFAULT_WATERMARK = 64

/**
 * The AUTHORITY's id-range allocator. Grants disjoint blocks off one monotonic counter, so every id
 * minted anywhere in the composition — on any surface — is unique. Session-scoped so a fresh run's ids
 * never collide with a prior run's persisted ids.
 */
export class IdAllocator {
  private blockSeq = 0
  constructor(private readonly session: string = randomSession()) {}

  /** Grant `surfaceId` its next block. The prefix folds the session, the surface (provenance only), and
   *  the monotonic block sequence (the disjointness guarantee). */
  grantBlock(surfaceId: string): IdBlock {
    return { prefix: `${this.session}-s${surfaceId}b${this.blockSeq++}`, size: DEFAULT_BLOCK_SIZE }
  }
}

/**
 * A SURFACE's view of its granted ids. Holds a queue of blocks (active first, then the reserve, then
 * any refills) and draws from the front SYNCHRONOUSLY. When the remaining count falls below the
 * watermark it kicks an async refill in the background, so a draw never waits. The reserve (a second
 * pre-held block) covers the window between a watermark trip and its refill landing, so even a remote
 * surface never runs dry mid-gesture.
 */
export class IdRange {
  private readonly blocks: { block: IdBlock; cursor: number }[] = []
  private requesting = false

  /** @param request how to obtain another block (sync in-process, async over IPC).
   *  @param watermark refill when remaining falls below this.
   *  @param initial the initial blocks (typically an active block plus a reserve). */
  constructor(
    private readonly request: BlockRequest,
    private readonly watermark: number,
    ...initial: IdBlock[]
  ) {
    for (const block of initial) this.blocks.push({ block, cursor: 0 })
  }

  /** Draw the next id, synchronously and finally. Kicks a background refill when the range runs low. */
  draw(): string {
    while (this.blocks.length > 0 && this.blocks[0].cursor >= this.blocks[0].block.size) this.blocks.shift()
    if (this.blocks.length === 0) {
      // The range emptied with no block in hand. In-process this can never happen (a sync request tops
      // up instantly). Over IPC it means the reserve + watermark were under-sized for the gesture — a
      // LOUD failure, never a silent local-mint fallback.
      const next = this.request()
      if (next instanceof Promise) {
        throw new Error(
          'IdRange: drew from an empty range with only an async refill available — reserve/watermark under-sized for this gesture',
        )
      }
      this.blocks.push({ block: next, cursor: 0 })
    }
    const head = this.blocks[0]
    const id = `${head.block.prefix}-${head.cursor++}`
    this.maybeRefill()
    return id
  }

  /** Total ids still drawable across all held blocks. */
  private remaining(): number {
    let n = 0
    for (const b of this.blocks) n += b.block.size - b.cursor
    return n
  }

  /** Request another block when low, at most one in flight. Sync grants append immediately; async grants
   *  append when they resolve. Either way a draw never blocks on it. */
  private maybeRefill(): void {
    if (this.requesting || this.remaining() >= this.watermark) return
    const next = this.request()
    if (next instanceof Promise) {
      this.requesting = true
      next
        .then((block) => this.blocks.push({ block, cursor: 0 }))
        .finally(() => {
          this.requesting = false
        })
    } else {
      this.blocks.push({ block: next, cursor: 0 })
    }
  }
}

function randomSession(): string {
  return Math.random().toString(36).slice(2, 10)
}
