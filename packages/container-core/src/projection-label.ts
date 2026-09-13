/**
 * Framework-agnostic projection label helpers for mastheads, tabs and drag labels.
 * Use declared presentation titles when available, with readable type-name derivation as a fallback.
 */

// Re-export bareTypeName from au-host-sdk so schema traversal and container labels share one parser.
import { bareTypeName, descriptorTitle, descriptorBreakpoints, type Breakpoint } from '@arsumbris/au-host-sdk';
export { bareTypeName };
export type { Breakpoint };

// Projection display titles come from projection-presentation-meta on ProjectionDescriptor.meta.
// The name derivation below is the fallback when no title is declared; see descriptorTitle in host-sdk.

/** Title-case a hyphen/dot-separated identifier. `bento-node.leaf` → `Bento Node Leaf`. */
function titleCase(name: string): string {
  return name
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The label to SHOW for a projection type. Pass the raw `instance.type` — qualification is stripped
 * here, so no caller has to remember to.
 *
 * THE DERIVATION IS DELIBERATELY DUMB: strip `::repo`, drop a `-kit` suffix (that names our
 * packaging, not the thing on screen), split on `-` / `.`, title-case. Right often enough to be worth
 * having, and where it is wrong the projection declares a `projection-presentation-meta` title that
 * wins (via `descriptorLabel` / `positionName`'s `declaredTitle`).
 *
 * Returns `''` for an absent type, matching `bareTypeName`, so a caller can keep using `|| 'empty'`
 * without a null check.
 */
export function projectionLabel(type: string | undefined): string {
  const bare = bareTypeName(type);
  if (!bare) return '';
  return titleCase(bare.replace(/-kit$/, ''));
}

/**
 * The label for a projection the host has DESCRIBED. Prefers the DECLARED title the descriptor
 * carries (`projection-presentation-meta`, read via `descriptorTitle`), so a masthead reads the
 * name a projection chose for itself; falls back to the derivation, so it is safe where no title is
 * declared.
 *
 * A type-def's `#:` docstring is NOT used: it is a sentence in the user's terms, right for a chooser
 * row and far too long for a masthead.
 */
export function descriptorLabel(
  descriptor: { type: string; meta?: Record<string, Record<string, unknown>> } | undefined,
  fallbackType?: string,
): string {
  return descriptorTitle(descriptor) ?? projectionLabel(descriptor?.type ?? fallbackType);
}

/**
 * A reusable `(type) => declared title` resolver over a host's `describeProjections()` set. A slot
 * header (a tab, a column item, a sandwich region) builds one per render pass and feeds the result
 * into `positionName`'s `declaredTitle`, so a projection's own name reaches the header WITHOUT the
 * header package reading the engine — the isolation reason the title rides the descriptor.
 *
 * Keyed by BARE type name, so a `::repo`-qualified occupant type resolves. Titleless projections are
 * simply absent from the map, and the lookup returns `undefined`, which `positionName` treats as
 * "fall through to the derivation".
 */
export function projectionTitleLookup(
  descriptors: readonly { type: string; meta?: Record<string, Record<string, unknown>> }[] | undefined,
): (type: string | undefined) => string | undefined {
  const byType = new Map<string, string>();
  for (const d of descriptors ?? []) {
    const title = descriptorTitle(d);
    if (title) byType.set(bareTypeName(d.type), title);
  }
  return (type) => {
    const bare = bareTypeName(type);
    return bare ? byType.get(bare) : undefined;
  };
}

/**
 * A reusable `(type) => declared compact sizes` resolver over a host's `describeProjections()` set,
 * the size-axis sibling of `projectionTitleLookup`. A container builds one per render pass and reads
 * its DIRECT child's declared sizes (`breakpoints-meta`) WITHOUT reading the engine — the isolation
 * reason the sizes ride the descriptor. WHICH size the container acts on, and any enum over them, is
 * the container's own concern; this only surfaces the declaration.
 *
 * Keyed by BARE type name, so a `::repo`-qualified occupant type resolves. A projection that declares
 * no sizes is absent from the map, and the lookup returns `[]`.
 */
export function projectionBreakpointsLookup(
  descriptors: readonly { type: string; meta?: Record<string, Record<string, unknown>> }[] | undefined,
): (type: string | undefined) => readonly Breakpoint[] {
  const byType = new Map<string, Breakpoint[]>();
  for (const d of descriptors ?? []) {
    const bps = descriptorBreakpoints(d);
    if (bps) byType.set(bareTypeName(d.type), bps);
  }
  return (type) => {
    const bare = bareTypeName(type);
    return (bare ? byType.get(bare) : undefined) ?? [];
  };
}

/** Just enough of a slot to name its position. Any `ContainerSlot` satisfies it. */
export interface LabelledSlot {
  label?: string;
}

/**
 * Resolve a position label: authored slot label, then declared occupant title, then type-name
 * derivation. Return an empty string for an unlabelled empty position.
 * The same rule applies to frame headers and selector entries, so a selectable child retains
 * an identifiable label even when its own content includes a header.
 */
export function positionName(
  slot: LabelledSlot | null | undefined,
  childType: string | undefined,
  declaredTitle?: string,
): string {
  return slot?.label ?? declaredTitle ?? projectionLabel(childType);
}
