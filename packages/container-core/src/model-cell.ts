/**
 * `ModelCell` — a container's runtime model, held so that a SEAM METHOD always reads the live one.
 *
 * THE HAZARD IT EXISTS FOR. One drop drives a container's `ContainerPlacement` several times in ONE
 * synchronous tick: `extract` on the source, `inject` on the target, and — when that target is a
 * container NESTED IN THE SOURCE — its save propagates straight back up through the child-config
 * writeback and commits again. Nothing has re-rendered in between. A container whose seam methods
 * and mutators read the model captured by the last RENDER therefore rebuilds that final commit from
 * a snapshot still holding what the first one removed: the pane reappears where it came from, an
 * infinite source, and it PERSISTS, because the resurrecting commit saves.
 *
 * WHY A CELL AND NOT A BETTER HOOK SIGNATURE. The discipline is irreducible. A thunk handed to a
 * hook is itself captured per render, so it closes over the same stale model; something, somewhere,
 * must hold the post-commit value synchronously. It cannot be removed, only LOCATED WELL — here,
 * once, instead of re-derived in every container.
 *
 * IT FINISHES A MECHANISM RATHER THAN ADDING ONE. `stableFacade` already decided that the router
 * must read the placement through an ACCESSOR rather than capture it. This is the same decision one
 * level down, for the data that placement reads.
 *
 * DELIBERATELY DUMB. Advance synchronously, then notify. No selectors, no derived state, no
 * equality tricks — the moment it grows those it becomes something a container author has to learn,
 * and its whole value is being smaller than the bug.
 *
 * THE MODEL IS THE LAYOUT, and only the layout. It fits a container whose layout model is ONE value
 * with a synchronous save — which is every container, bento included. Auxiliary state stays SEPARATE
 * (bento's detached windows, focus recency; tabs' preview partition), never folded into the cell.
 * The substrate's detector still covers a container that never adopts the cell (vanilla, third-party).
 */

import { reportHostDiagnostic } from '@arsumbris/au-host-sdk';

export interface ModelCell<T> {
  /** The LIVE model — the last committed value, readable synchronously within the same tick. */
  read: () => T;
  /**
   * Advance the model and notify. The new value is readable through `read()` IMMEDIATELY, before
   * any subscriber runs and before any framework re-renders, which is the entire point.
   */
  commit: (next: T) => void;
  /** Observe commits. Returns an unsubscribe. */
  subscribe: (listener: (next: T) => void) => () => void;
}

export function createModelCell<T>(initial: T): ModelCell<T> {
  let current = initial;
  const listeners = new Set<(next: T) => void>();
  return {
    read: () => current,
    commit: (next) => {
      // ADVANCE FIRST. A listener may commit again re-entrantly (a nested container's save comes
      // back through this same path), and that commit must build on `next`, never on the value it
      // replaced.
      current = next;
      for (const l of [...listeners]) l(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * THE ROUND-TRIP GUARD — assert a container's RE-SEED READ is DETERMINISTIC, so the resync-churn
 * violation is LOUD instead of a silent id churn. The `read` passed in is the EXACT predicate the
 * resync gate compares: `toConfig ∘ fromConfig` when the container serializes runtime-only state away,
 * else `fromConfig` alone (the hook composes it). That is precisely the churn condition — the resync
 * re-seeds iff two reads of the SAME record differ THROUGH the gate, so checking anything else would
 * mis-fire. The churn root is a `fromConfig` that MINTS a fresh position id (`genId()`) each read AND
 * carries it into the gate: two reads of the SAME record then differ, so the gate never short-circuits
 * and re-seeds on every pool event tree-wide, churning every id. Deriving the id from the host-owned
 * `^:` (`slot.id ?? child.id`), OR stripping it in `toConfig` (bento drops position ids in
 * `bentoRecord`), makes the read deterministic.
 *
 * Pure + framework-agnostic — a vanilla container gets the same guard as a React one; the CALLER gates
 * it to dev. It does NOT flag a legitimate runtime partition the gate strips (tabs' preview, bento's
 * minted position ids): `toConfig` removes it, so two gate reads still agree.
 */
export function assertDeterministicRead<T>(
  label: string,
  raw: unknown,
  read: (raw: unknown) => T,
): void {
  let a: unknown;
  let b: unknown;
  try {
    a = read(raw);
    b = read(raw);
  } catch {
    return; // a read that throws is a different problem; the guard does not pile on.
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  reportHostDiagnostic({
    code: 'container-read-nondeterministic',
    severity: 'warning',
    message: `container "${label}": its RE-SEED READ is NON-DETERMINISTIC — two reads of the same record differ through the config-space gate, so the resync churns on every pool event. A fromConfig that MINTS a runtime id (a position id via genId) churns UNLESS toConfig strips it; derive the id from the host-owned ^: (slot.id ?? child.id), or strip it in toConfig.`,
    subject: label,
    detail: { first: a, second: b },
  });
}
