// THE HOST DECISION RESOLVER — one ladder for every "which one?" the host answers, so the behaviour is
// uniform and no choice is ever a silent default.

// A decision is DATA: `(candidates, a configured default, standing options)`. The ladder is:
//   1. a CONFIGURED default exists → use it            (unless force-ask deliberately skips it)
//   2. else the eligible candidate count decides:
//        0 → NOTHING   the caller owns the empty outcome (an empty slot; the open-chooser floor)
//        1 → SOLE      the only door — not a default, nothing to get wrong
//        2+ → ASK      the host chooser surfaces the candidates; never a silent default among alternatives
//   3. a configured default naming a candidate that no longer exists FALLS THROUGH to the count. Honest degradation.
// FORCE-ASK skips the configured default and asks, so a set default is a convenience, not a lock. It asks
// only when there is MORE THAN ONE thing to present (candidates + standing options); a lone candidate with
// nothing beside it is returned, not asked.

// This module is the PURE rule (synchronous, testable, no chooser). The ASK is a host layer OVER it: the
// caller maps an `ask` outcome's option ids to labels and awaits `host.chooser.choose(...)`, then performs
// the action. The pure `suggested` remains the answer for non-interactive and test paths.
//


// TWO INSTANTIATIONS of the ONE principle, distinguished only by where "configured" and "candidates" come from:

//   VALUE (which viewer / which placeholder / which container-kind): "configured" is a value the composition
//   carries in a composition-config aspect (e.g. `viewer-defaults`), keyed by the decision's context (the
//   file kind, the slot); "candidates" are the eligible implementations. `resolveViewer` (viewer-resolve.ts)
//   and `chooseGrouping` (grouping.ts) are the two live value instantiations — both now express their
//   ladder over `resolveDecision` and translate the outcome into their own domain shape.

//   TARGET (which pane an open lands in): "configured" is the composition's `intent-routing` aspect (wires +
//   defaults); "candidates" are LIVE handlers ordered most-recently-focused; the presentation carries
//   STANDING options (open in a new window, wrap a container). This instantiation is NOT re-implemented here:
//   it lives in the intent dispatch pipeline (`intent-channel.ts`'s `IntentTree` — seed → constrain → consume)
//   and the open floor (`composition.ts`'s `openFloor`). The mapping onto this ladder:
//     wire-override / explicit route → CONFIGURED · a lone focused handler → SOLE · several handlers or the
//     force-ask strategy → ASK (with new-window / wrap as standing options) · no handler → NOTHING (the floor).



// An explicit PER-ACTION override (the viewer's firer-supplied `open-intent.with`, a routing wire) sits
// ABOVE this core: the caller applies it and never calls `resolveDecision`. It is not the "configured"
// default (force-ask must not skip a per-action explicit choice), so it is a wrapper concern, not a rung here.

/** The outcome of the one decision ladder. Ids are opaque to the resolver; the caller maps them to
 *  implementations (a viewer type, a container kind) and to chooser labels. */
export type ResolveOutcome =
  /** A configured default resolved it. */
  | { kind: 'configured'; id: string }
  /** Exactly one eligible candidate — the sole door. */
  | { kind: 'sole'; id: string }
  /** A genuine choice: the caller surfaces the host chooser over `options`. `suggested` is a STARTING
   *  highlight only (the configured default under force-ask, else the display-first candidate). */
  | { kind: 'ask'; options: readonly string[]; suggested: string }
  /** Nothing eligible — the caller owns the empty outcome. */
  | { kind: 'nothing' };

/** A decision expressed as data. `candidates` are the eligible ids, priority/display-ordered (first is the
 *  pure default). `configured` is the composition's default id, if any — IGNORED when it is not among the
 *  candidates (stale → honest fall-through). `standingOptions` are extra ids the ASK offers beyond the
 *  candidates (the target instantiation's new-window / wrap); empty for the value instantiations. */
export interface Decision {
  candidates: readonly string[];
  configured?: string;
  standingOptions?: readonly string[];
}

/** Resolve a decision through the one ladder (`configured > sole > ask > nothing`), with force-ask. Pure
 *  and synchronous: it decides, it never asks — the caller layers the host chooser over an `ask` outcome. */
export function resolveDecision(decision: Decision, opts?: { forceAsk?: boolean }): ResolveOutcome {
  const { candidates, configured, standingOptions = [] } = decision;
  const forceAsk = opts?.forceAsk ?? false;
  const configuredValid = configured != null && candidates.includes(configured);

  // 1. A configured default wins — unless force-ask deliberately skips it. A stale configured (not among
  //    the candidates) is already absent here, so it falls through to the count below.
  if (!forceAsk && configuredValid) return { kind: 'configured', id: configured };

  const options = [...candidates, ...standingOptions];
  const somethingToPresent = options.length > 1;
  const suggested = configuredValid ? configured : candidates[0];

  // 2a. Nothing eligible. Force-ask may still present standing options (a genuine choice among them);
  //     otherwise the caller owns the empty outcome (an empty slot; the open floor).
  if (candidates.length === 0) {
    if (forceAsk && somethingToPresent) return { kind: 'ask', options, suggested: options[0]! };
    return { kind: 'nothing' };
  }

  // 2b. The sole candidate — nothing to get wrong. Force-ask presents ONLY when there is more than one
  //     thing to present (the candidate plus standing options); otherwise it returns that one.
  if (candidates.length === 1) {
    if (forceAsk && somethingToPresent) return { kind: 'ask', options, suggested: suggested! };
    return { kind: 'sole', id: candidates[0]! };
  }

  // 2c. Two or more candidates — ASK. Never a silent default among alternatives.
  return { kind: 'ask', options, suggested: suggested! };
}
