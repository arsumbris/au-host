/**
 * Empty-slot projection picker. Shown in an empty pane/slot: a searchable, keyboard-navigable list of
 * the host-discovered projections, grouped into sections, plus a free-text row for an undiscovered id.
 * Type to filter, ↑/↓ to move, ⏎ to mount.
 *
 * Native input and option buttons share one DOM tree so aria-activedescendant can reference the
 * active result. Presentation uses shared theme roles; the list owns overflow while the search
 * field retains its control height. This picker is shared by container projections.
 *
 * ROWS READ THE HUMAN NAME via `descriptorLabel` — a projection's declared `projection-presentation-meta`
 * title, else a derivation. The raw type stays FINDABLE: the search matches the id too, and each row
 * retains its owning repository as visible context.
 *
 * SECTIONS by KIND CLOSURE: a container is "Layouts", a leaf pane is "Content", else "Other". Content
 * first — "what do I want to look at" before "what kind of surface".
 *
 * Any container with a fillable empty slot can use this picker. Files are opened through
 * the file-tree; this list discovers projection types.
 */

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { descriptorIcon, type MountHost, type ProjectionDescriptor } from '@arsumbris/au-host-sdk';
import { AuScrollArea, AuListRow, AuIcon, AuKbd, AuEmptyState } from '@arsumbris/au-component-catalog/react';
import { surfaceRecipes } from '@arsumbris/au-component-catalog/surface-recipes';
import { descriptorLabel, refToTypeName } from '@arsumbris/container-core';

/** The descriptor set the picker shows. Prefers the host's DESCRIBED set (names + kinds); falls
 *  back to bare `listProjections()` names as minimal descriptors, so a host that predates
 *  `describeProjections` degrades to a titleless "Other" list rather than crashing. */
export function describeForPicker(host: MountHost): ProjectionDescriptor[] {
  const descriptors = host.describeProjections?.() ?? host.listProjections().map((type) => ({ type, repo: '', kinds: [] as string[] }));
  return descriptors.filter(descriptor => !descriptor.kinds.includes('placeholder-projection'));
}

/** Build the picker's admits-hint from a slot and the pre/post-filter counts: how many the caller hid
 *  and which types the slot admits (bared). Returns undefined when the slot declares no `admits`, so a
 *  fully-open slot shows no hint. Shared by every picker surface (empty-slot fill + swap). */
export function admitsNoteFor(
  slot: { admits?: readonly string[] } | null,
  total: number,
  offered: number,
): { hidden: number; admits: readonly string[] } | undefined {
  const admits = slot?.admits;
  if (!admits || admits.length === 0) return undefined;
  return {
    hidden: Math.max(0, total - offered),
    admits: admits.map((r) => refToTypeName(r)).filter((n): n is string => !!n),
  };
}

interface PickItem {
  id: string;
  label: string;
  section: string;
  meta: string;
  icon: string;
  disambiguate: boolean;
}

/** Which section a descriptor sits under, from its kind CLOSURE. Container before pane, because a
 *  container's closure carries neither the other's kind and this keeps the test unambiguous. */
function sectionOf(kinds: readonly string[]): string {
  if (kinds.includes('placeholder-projection')) return 'Other options';
  if (kinds.includes('container-projection')) return 'Layouts';
  if (kinds.includes('pane-projection')) return 'Content';
  return 'Other';
}

const SECTION_RANK: Record<string, number> = { Content: 0, Layouts: 1, Other: 2, 'Other options': 3 };

function toItems(descriptors: readonly ProjectionDescriptor[]): PickItem[] {
  const labels = descriptors.map((descriptor) => descriptorLabel(descriptor));
  return descriptors
    .map((d): PickItem => ({
      id: d.type,
      label: descriptorLabel(d),
      section: sectionOf(d.kinds),
      meta: d.repo,
      icon: descriptorIcon(d) ?? 'panel-top',
      disambiguate: labels.filter((label) => label === descriptorLabel(d)).length > 1,
    }))
    .sort((a, b) => (SECTION_RANK[a.section]! - SECTION_RANK[b.section]!) || a.label.localeCompare(b.label));
}

function match(query: string): (it: PickItem) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  return (it) =>
    it.label.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) || it.meta.toLowerCase().includes(q);
}

// Shared container picker presentation, resolved through the active theme.

// The cancel action reads as a footer hint, not a button — same weight as the keyboard legends
// beside it, because it does the same thing Esc does.
const footCancelStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'var(--au-ink-3)',
  cursor: 'pointer',
};

// The admits-filter hint: a small line under the list explaining a short offered set is a deliberate
// slot restriction, not an empty workspace. Same muted weight as the footer legends.
export function PanePicker({
  onPick,
  descriptors,
  title = 'Add to this pane',
  onCancel,
  admitsNote,
  library = false,
}: {
  /** Expanded discovery layout; retains the same shared rows as swap surfaces. */
  library?: boolean;
  onPick: (id: string) => void;
  descriptors: readonly ProjectionDescriptor[];
  /** Heading over the picker. Default "Add to this pane"; swap passes "Swap this pane". */
  title?: string;
  /** Back out without picking — bound to Esc and a footer hint. OMIT when there is nothing to back
   *  out TO (an empty slot the picker fills): a cancel that destroys the slot is the caller's, not
   *  the picker's. Swap passes it, because the pane it replaces is still there to keep. */
  onCancel?: () => void;
  /** When the caller has FILTERED the offered set by the slot's `admits`, how many it hid and which
   *  types the slot admits — rendered as a small line so a short list reads as a deliberate restriction,
   *  not a bare workspace. Omit (or `hidden: 0`) when nothing was filtered. `admits` are bare names. */
  admitsNote?: { hidden: number; admits: readonly string[] };
}): ReactNode {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo(() => toItems(descriptors), [descriptors]);
  const filtered = useMemo(() => items.filter(match(query)).filter((item) => !library || query.trim() !== '' || showOther || item.section !== 'Other options'), [items, query, library, showOther]);

  // Groups in section order, preserving the sorted item order within each.
  const groups = useMemo(() => {
    const map = new Map<string, PickItem[]>();
    for (const it of filtered) {
      const rows = map.get(it.section);
      if (rows) rows.push(it);
      else map.set(it.section, [it]);
    }
    return [...map.entries()].sort((a, b) => (SECTION_RANK[a[0]] ?? 9) - (SECTION_RANK[b[0]] ?? 9));
  }, [filtered]);

  // Flat display order drives keyboard navigation over discovered, allowed views.
  const flat = useMemo(() => groups.flatMap(([, rows]) => rows), [groups]);
  const typed = query.trim();
  const total = flat.length;
  const clamped = total === 0 ? 0 : Math.min(active, total - 1);

  const pickAt = (index: number): void => {
    if (index < flat.length) onPick(flat[index]!.id);
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [clamped, flat]);

  useEffect(() => {
    if (showOther) listRef.current?.querySelector<HTMLElement>('[aria-label="Other options"]')?.scrollIntoView({ block: 'nearest' });
  }, [showOther]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (total === 0 ? 0 : (a + 1) % total));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (total === 0 ? 0 : (a - 1 + total) % total));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickAt(clamped);
    } else if (e.key === 'Escape' && onCancel) {
      // Esc backs out of the whole picker (does not just clear the query): the picker occupies a
      // slot the user did not ask to change, so the first Esc gets them out of it.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  // A running index across groups so keyboard `active` and the visual rows line up.
  let cursor = -1;

  return (
    <div data-pane-picker className="au-content-pane" style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
      <style>{surfaceRecipes}</style>
      <div className="au-picker au-content-measure">
        <div className="au-picker-heading">{library ? 'Add a view' : title}</div>
        <input
          className="au-picker-search"
          value={query}
          placeholder="Search views…"
          spellCheck={false}
          autoFocus
          role="combobox"
          aria-label="Search available panes"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={total > 0 ? `${listId}-${clamped}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <AuScrollArea axis="y" style={{ flex: '1 1 0', minHeight: 0, minWidth: 0 }}>
        <div ref={listRef} id={listId} role="listbox" aria-label="Available panes" className="au-picker-list">
          {total === 0 ? (
            <AuEmptyState label={typed ? 'No matches' : 'Nothing available yet'}
              hint={typed ? 'No pane matches that search.' : 'The workspace has not reported any mountable types yet.'} />
          ) : (
            <>
              {groups.map(([section, rows]) => (
                <div key={section} role="group" aria-label={section} style={{ minWidth: 0, marginBottom: library ? 'var(--au-space-4)' : undefined }}>
                  <div className="au-picker-section">{section}</div>
                  <div className="au-picker-options">
                  {rows.map((it) => {
                    cursor += 1;
                    const index = cursor;
                    return (
                      <button
                        key={it.id}
                        data-row={index}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={index === clamped}
                        tabIndex={-1}
                        type="button"
                        title={it.id}
                        aria-label={it.disambiguate ? `${it.label} — ${it.meta}` : it.label}
                        className="au-picker-option"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActive(index)}
                        onClick={() => onPick(it.id)}
                      >
                        <AuListRow wrap primary={it.label} secondary={it.meta || undefined} selected={index === clamped}>
                          <AuIcon slot="leading" name={it.icon} size="sm" aria-hidden="true" />
                        </AuListRow>
                      </button>
                    );
                  })}
                  </div>
                </div>
              ))}

            </>
          )}
          {library ? <div role="presentation" style={{ color: 'var(--au-ink-3)', fontSize: 'var(--au-t-sm)', lineHeight: 'var(--au-lh-sm)', padding: 'var(--au-space-1) var(--au-space-2) var(--au-space-3)' }}>Choose a projection for this pane, or open a file from the sidebar.</div> : null}
        </div>
        </AuScrollArea>
        {admitsNote && admitsNote.hidden > 0 ? (
          <div className="au-picker-note">
            {admitsNote.hidden} {admitsNote.hidden === 1 ? 'option' : 'options'} hidden — this slot admits only{' '}
            {admitsNote.admits.length > 0 ? admitsNote.admits.join(', ') : 'nothing'}
          </div>
        ) : null}
        {library && items.some((item) => item.section === 'Other options') && !query.trim() ? (
          <button type="button" aria-expanded={showOther} onClick={() => { setShowOther(!showOther); setActive(0); }} style={{ ...footCancelStyle, fontSize: 'var(--au-t-xs)', color: 'var(--au-ink-3)', marginLeft: 0, textAlign: 'left', padding: 'var(--au-space-2) 0' }}>
            {showOther ? '▾' : '▸'} Other options
          </button>
        ) : null}
        <div className="au-picker-footer">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}><AuKbd>↑ ↓</AuKbd> Navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--au-space-1)' }}><AuKbd keys="Enter" /> Open</span>
          <span role="status" style={{ marginLeft: 'auto' }}>{flat.length} {flat.length === 1 ? 'view' : 'views'}</span>
          {onCancel ? (
            <button type="button" onClick={onCancel} style={{ ...footCancelStyle }}>
              Cancel (Esc)
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
