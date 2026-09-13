/**
 * THE EMPTY-SLOT DRIVER — the substrate's ONE realization of what an empty slot shows, replacing every
 * container's hand-wired `<PanePicker>` branch.
 *
 * This RESOLVES which `placeholder-projection` shows through the one host decision ladder over the
 * INSTALLED placeholder set, then:
 *   - a concrete placeholder resolved (the sole installed one, or a configured default) → it is
 *     MATERIALIZED as the slot's occupant via the placement seam (`setPaneContent`). It becomes ordinary
 *     content — rendered by the container's normal pane path (auto-pooled, focus-MRU, view-state) and
 *     persisted on save like anything else. Resolving IS materializing; there is no ephemeral tier
 *     `EmptySlot` then self-replaces (the slot now has a child).
 *   - 2+ installed and no default → the rare in-pane ASK ("which placeholder here?"); the pick materializes.
 *   - 0 installed → a genuine HOLE (no occupant, nothing persisted); the shipped bundle always provides
 *     one, so this is the degenerate case.
 *
 * So `EmptySlot` MOUNTS nothing itself — it resolves and fills, and the container's ordinary occupant
 * path renders the placeholder as a normal pane.

 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContainerSlot, MountHost, PaneId, ProjectionDescriptor } from '@arsumbris/au-host-sdk';
import { descriptorTitle } from '@arsumbris/au-host-sdk';
import { bareTypeName, placementForPane, refToTypeName, resolveDecision, setPaneContent, slotAdmits, slotFor } from '@arsumbris/container-core';

import {PanePicker, describeForPicker, admitsNoteFor} from './PanePicker';

/** The bare kind name every `placeholder-projection` subtype carries in its `kinds` closure. */
const PLACEHOLDER_KIND = 'placeholder-projection';

/** The installed placeholder-projection subtypes (concrete), in descriptor order. Membership is by
 *  CLOSURE, so a third-party placeholder is recognised without this reader knowing its name. */
function placeholderCandidates(host: MountHost): ProjectionDescriptor[] {
  return (host.describeProjections?.() ?? []).filter((d) => d.kinds.includes(PLACEHOLDER_KIND));
}

/** A human label for a placeholder in the (rare) 2+ ask — its declared title, else its bare type name. */
function candidateLabel(d: ProjectionDescriptor): string {
  return descriptorTitle(d) ?? d.type;
}

/**
 * The empty-slot content for the position `slotId`. Drop it in a container's empty branch in place of the
 * hand-wired picker: `state.child ? <PaneProjection …/> : <EmptySlot host slotId={paneId} />`.
 */
export function EmptySlot({ host, slotId }: { host: MountHost; slotId: PaneId }): ReactNode {
  // Fill AT MOST ONCE. A refused fill (a slot whose `admits` excludes the placeholder) must not loop;
  // it falls to the hint below instead.
  const filled = useRef(false);
  const [refused, setRefused] = useState(false);
  const [fillError, setFillError] = useState('');

  const candidates = useMemo(() => placeholderCandidates(host), [host]);

  // RESOLVE THIS SLOT to read its per-slot `placeholder` override. It is resolved in an EFFECT, not in
  // render: this component renders the `data-pane-id={slotId}` anchor `placementForPane` needs, and that
  // anchor is only in the DOM after commit. `undefined` = not yet resolved; `null` = resolved, no slot
  // rules. The materialize below is GATED on this being resolved, so a per-slot override is never missed
  // by the fill firing against a not-yet-known slot.
  const [slot, setSlot] = useState<ContainerSlot | null | undefined>(undefined);
  useEffect(() => {
    const placement = placementForPane(slotId);
    setSlot(placement ? slotFor(placement, slotId) : null);
  }, [slotId]);

  // The `configured` rung of the ladder, as an OVERRIDE: a per-slot `container-slot.placeholder` (a def-ref
  // on this slot) takes precedence over the composition-wide `slot-defaults` (`host.slotDefaults`, bared).
  // Matched by BARE name (a candidate's `type` may be `::repo`-qualified) and passed in the CANDIDATE's own
  // form, so `resolveDecision`'s exact-match honours it and `materialize` writes the same form the sole path
  // does. A stale value (naming an uninstalled placeholder) is not among the candidates, so the resolver
  // falls through to the count.
  const configured = useMemo(() => {
    const raw = slot?.placeholder;
    const wanted = raw != null ? refToTypeName(raw as string) : host.slotDefaults?.();
    return wanted ? candidates.find((c) => bareTypeName(c.type) === wanted)?.type : undefined;
  }, [candidates, slot, host]);
  // The one decision ladder: configured > sole > ask > nothing (0 → nothing, 1 → sole, 2+ → ask).
  const outcome = useMemo(
    () => resolveDecision({ candidates: candidates.map((c) => c.type), configured }),
    [candidates, configured],
  );

  // MATERIALIZE the resolved placeholder as the slot's occupant (the placement seam routes `slotId` back
  // to its container's `setSlotContent`). The container re-renders with a child and its normal pane path
  // takes over; this `EmptySlot` unmounts. Authors only a TYPE name — the placeholder authors its own
  // fields, honouring "a container places its child, it never authors the child's config fields".
  const materialize = (type: string): void => {
    if (filled.current) return;
    filled.current = true;
    const ok = setPaneContent(slotId, { type });
    if (!ok) setRefused(true);
  };

  useEffect(() => {
    if (slot === undefined) return; // WAIT until this slot is resolved, so a per-slot `placeholder` override is not missed.
    if (outcome.kind === 'sole' || outcome.kind === 'configured') materialize(outcome.id);
    // `slotId` + `outcome` are the fill inputs; `materialize` is guarded idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, slot, outcome]);

  // The HOLE content, if any. `null` for sole/configured — the effect materialized the occupant and this
  // tick is transient. Otherwise a host-owned line so a genuinely empty slot never reads as broken.
  const directPicker = refused || outcome.kind === 'nothing';
  const hole: ReactNode = directPicker ? (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0}}>
      {fillError && <p role="alert" style={descriptionStyle}>{fillError}</p>}
      <PanePicker
        descriptors={describeForPicker(host).filter(candidate => slotAdmits(slot ?? null, candidate.type))}
        admitsNote={admitsNoteFor(slot ?? null, describeForPicker(host).length, describeForPicker(host).filter(candidate => slotAdmits(slot ?? null, candidate.type)).length)}
        onPick={type => {
          const ok = setPaneContent(slotId, {type});
          setFillError(ok ? '' : 'This view could not be placed. Check this pane’s placement rules and try again.');
        }}
      />
    </div>
  ) : outcome.kind === 'ask' ? (
    <section style={choicePanel} aria-label="Set up this pane">
      <div style={headingStyle}>Make room for your work</div>
      <p style={descriptionStyle}>Choose how this empty pane starts.</p>
      <div style={choiceList}>
        {candidates.map((c) => (
          <button key={c.type} type="button" style={choiceButton} onClick={() => materialize(c.type)}>
            {candidateLabel(c)}
          </button>
        ))}
      </div>
    </section>
  ) : null;

  // ALWAYS render the `data-pane-id` anchor so `setPaneContent(slotId, …)` DOM-resolves this slot's
  // container (a container's `findPane` may not match an EMPTY position, so the placement lookup relies
  // on this anchor, not on `findPane`). The hole content, when present, renders centred inside it.
  return (
    <div data-pane-id={slotId} style={directPicker ? plainBox : hole ? hintBox : plainBox}>
      {hole}
    </div>
  );
}

const plainBox = { height: '100%' } as const;
const hintBox: CSSProperties = {
  height: '100%', minHeight: 0, boxSizing: 'border-box', overflow: 'auto',
  display: 'grid', placeItems: 'center', padding: 'var(--au-space-6)',
  fontFamily: 'var(--au-font-sans)', fontSize: 'var(--au-t-sm)',
  lineHeight: 'var(--au-lh-sm)', color: 'var(--au-ink-3)', textAlign: 'center',
};
const choicePanel: CSSProperties = {
  width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column',
  alignItems: 'center', gap: 'var(--au-space-2)',
};
const headingStyle: CSSProperties = {
  color: 'var(--au-ink-1)', fontSize: 'var(--au-t-base)',
  fontWeight: 'var(--au-w-medium)' as unknown as number,
};
const descriptionStyle: CSSProperties = { margin: 0, color: 'var(--au-ink-3)' };
const choiceList: CSSProperties = {
  display: 'flex', gap: 'var(--au-space-2)', flexWrap: 'wrap', justifyContent: 'center',
  marginTop: 'var(--au-space-3)', maxWidth: '100%',
};
const choiceButton: CSSProperties = {
  minHeight: 'var(--au-space-7)', maxWidth: '100%', overflowWrap: 'anywhere',
  padding: 'var(--au-space-2) var(--au-space-3)',
  border: '1px solid var(--au-line-2)', borderRadius: 'var(--au-radius-md)',
  background: 'var(--au-color-surface-2)', color: 'var(--au-ink-1)',
  font: 'inherit', cursor: 'pointer', outlineColor: 'var(--au-focus-outer)', outlineOffset: 'var(--au-space-0-5)',
};
