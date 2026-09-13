// VIEWER RESOLUTION — which projection opens a file, resolved through an EXPLICIT ladder, never an
// implicit default.

// A file open must become a VIEWER. `opens-meta` declares only which viewers are ELIGIBLE for a file
// (the fold lives in `@arsumbris/au-host-sdk`: `viewersFor` — the eligible set, most-specific first for
// DISPLAY; `extensionOf`). Eligibility is a CAPABILITY, not a decision: a viewer declaring it opens `md`
// does not thereby become the default for md. The DECISION is made explicitly, or it is asked.

// resolveViewer chooses in order: open-intent.with, the composition's viewer-defaults entry,
// the sole eligible viewer, or a must-pick outcome that the caller presents as a chooser.




import { viewersFor, extensionOf, descriptorTitle, bareTypeName, event, on } from '@arsumbris/au-host-sdk';
import { resolveDecision } from './resolve.ts';

export { extensionOf, viewersFor } from '@arsumbris/au-host-sdk';

type ViewerDescriptor = { type: string; meta?: Record<string, Record<string, unknown>> };

/** One composition viewer-default, NORMALIZED for resolution: a file kind mapped to a BARE viewer type
 *  name. The host bares the def-ref value (`[[editor-pane::editor]]` -> `editor-pane`) before handing it
 *  here, so this module compares bare-to-bare against the `viewersFor` set. */
export type ViewerDefaultEntry = { opens: string; viewer: string };

/** The outcome of resolving a viewer: a decided viewer type, or a MUST-PICK with the eligible set (the
 *  caller surfaces a picker). `mustPick` is empty when NO viewer is eligible — the caller declines. */
export type ViewerResolution = { viewer: string } | { mustPick: readonly string[] };

/**
 * Resolve the viewer for `filePath` through the explicit ladder (never an implicit default):
 * 1. `opts.with` — the firer's explicit `open-intent.with` choice. Unconditional (the firer knows; a
 *    file-tree "Open with" only offers eligible viewers).
 * 2. A composition `viewer-defaults` entry whose `opens` matches the file's extension (or `*`) AND whose
 *    viewer is ELIGIBLE for the file.
 * 3. The SOLE eligible viewer — the only door, not a default.
 * 4. Otherwise MUST-PICK: the eligible set. `{ mustPick: [] }` when nothing is eligible (caller declines);
 *    `{ mustPick: [>=2] }` when there is a genuine choice (caller surfaces a picker).
 */
export function resolveViewer(
  filePath: string,
  descriptors: readonly ViewerDescriptor[] | undefined,
  opts?: { with?: string; viewerDefaults?: readonly ViewerDefaultEntry[] },
): ViewerResolution {
  // The firer's explicit `open-intent.with` sits ABOVE the ladder: a per-action choice the resolver's
  // force-ask must never skip, so it is a wrapper short-circuit, not the "configured" rung. See resolve.ts.
  if (opts?.with) {
    if (on('viewer')) event('viewer', 'resolved', { file: filePath, viewer: opts.with, how: 'with' });
    return { viewer: opts.with };
  }
  // The value instantiation of the one ladder: candidates are the eligible viewers (display-ranked), and
  // "configured" is the composition `viewer-defaults` entry whose `opens` matches this file AND whose
  // viewer is eligible (so a stale/ineligible default is simply not passed).
  const eligible = viewersFor(filePath, descriptors); // bare type names, display-ranked
  const ext = extensionOf(filePath);
  const def = opts?.viewerDefaults?.find(
    (d) => (d.opens === ext || d.opens === '*') && eligible.includes(d.viewer),
  );
  const outcome = resolveDecision({ candidates: eligible, configured: def?.viewer });
  switch (outcome.kind) {
    case 'configured':
    case 'sole':
      if (on('viewer')) event('viewer', 'resolved', { file: filePath, viewer: outcome.id, how: outcome.kind });
      return { viewer: outcome.id };
    case 'ask':
      // A genuine choice (>=2 eligible): the caller surfaces the picker over the eligible set.
      if (on('viewer')) event('viewer', 'must-pick', { file: filePath, options: [...outcome.options] });
      return { mustPick: outcome.options };
    case 'nothing':
      // Nothing eligible: the caller declines (no viewer can render this file).
      if (on('viewer')) event('viewer', 'no-viewer', { file: filePath });
      return { mustPick: [] };
  }
}

/** One option for the host chooser when a viewer must be picked: a viewer TYPE id plus its DECLARED
 *  title (projection-presentation-meta), falling back to the bare type name. The label convention
 *  matches the file-tree "Open with" menu, kept HERE so the several must-pick sites cannot drift. */
export type ViewerPickOption = { id: string; label: string };

/** Build the chooser option list for a viewer must-pick, from the candidate viewer type names and the
 *  projection descriptors (`host.describeProjections()`). Preserves the candidates' order (display-ranked). */
export function viewerPickOptions(
  candidates: readonly string[],
  descriptors: readonly ViewerDescriptor[] | undefined,
): ViewerPickOption[] {
  return candidates.map((v) => ({
    id: v,
    label: descriptorTitle((descriptors ?? []).find((d) => bareTypeName(d.type) === v)) ?? v,
  }));
}
