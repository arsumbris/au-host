/**
 * Shared pane-action buttons: grip, swap and close. Containers own their header layout and action
 * handlers; this component supplies consistent glyphs, token styling, hover and fixed-state behavior.
 *
 * A fluid slot shows a drag grip; a fixed slot shows a non-draggable lock. The container includes
 * only applicable actions, and can render separate fragments on either side of its label.
 * Handlers receive the event so containers can stop propagation to their own header interactions.
 */

import { useState, type CSSProperties, type PointerEvent, type MouseEvent, type ReactNode } from 'react';

export type PaneActionKind = 'grip' | 'swap' | 'close';

export interface PaneAction {
  kind: PaneActionKind;
  /** grip only: when true, render the fixed LOCK glyph instead of the drag grip (non-draggable). */
  fixed?: boolean;
  /** grip: pointerdown starts the container's drag. Ignored when `fixed`. */
  onPointerDown?: (e: PointerEvent) => void;
  /** swap / close: the click handler. Also valid on grip as a shield — a header with its own click
   *  (column's collapse toggle) passes `(e) => e.stopPropagation()` so a grip click never toggles it.
   *  Receives the event. */
  onClick?: (e: MouseEvent) => void;
  /** Override the default title — containers name their unit differently ("pane" / "item" / "region"). */
  title?: string;
}

const GLYPH: Record<PaneActionKind, string> = { grip: '⠿', swap: '⇄', close: '✕' };
const LOCK_GLYPH = '⚲';

const DEFAULT_TITLE: Record<PaneActionKind, string> = {
  grip: 'Drag this pane',
  swap: 'Swap this pane',
  close: 'Close pane',
};
const LOCK_TITLE = 'Fixed — this pane cannot be moved out or closed';

/** Hover TEXT color per kind — the headers' existing hover colors (both already tokens). */
const HOVER: Record<PaneActionKind, string> = {
  grip: 'var(--au-ink-1)',
  swap: 'var(--au-ink-1)',
  close: 'var(--au-color-danger)',
};

/** Hover backgrounds distinguish destructive close actions from neutral grip and swap actions. */
const HOVER_BG: Record<PaneActionKind, string> = {
  grip: 'var(--au-color-surface-2)',
  swap: 'var(--au-color-surface-2)',
  close: 'color-mix(in srgb, var(--au-color-danger) 22%, transparent)',
};

function glyphStyle(hovered: boolean, kind: PaneActionKind, draggable: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    minWidth: 20,
    height: 20, // a real hit target (20×20)
    padding: '0 3px',
    borderRadius: 'var(--au-radius-sm)',
    fontSize: 'var(--au-t-xs)',
    lineHeight: 1,
    color: hovered ? HOVER[kind] : 'var(--au-ink-3)',
    background: hovered ? HOVER_BG[kind] : 'transparent',
    cursor: draggable ? 'grab' : 'pointer',
    ...(draggable ? { touchAction: 'none' } : null),
    userSelect: 'none',
    flexShrink: 0, // a glyph sitting in a flex label (bento) must not squish
  };
}

/** The fixed-slot lock — static, non-interactive, muted a rung below the live glyphs. Same footprint
 *  as the live glyphs so the header does not jump when a slot is fixed. */
const lockStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  minWidth: 20,
  height: 20,
  padding: '0 3px',
  fontSize: 'var(--au-t-xs)',
  lineHeight: 1,
  color: 'var(--au-ink-4)',
  userSelect: 'none',
  flexShrink: 0,
};

/** One action glyph. Own hover state so no `:hover` CSS is needed (the PanePicker convention). */
function ActionGlyph({ action }: { action: PaneAction }): ReactNode {
  const [hover, setHover] = useState(false);
  const { kind, fixed } = action;

  if (kind === 'grip' && fixed) {
    return (
      <span title={action.title ?? LOCK_TITLE} style={lockStyle}>
        {LOCK_GLYPH}
      </span>
    );
  }

  const draggable = kind === 'grip';
  return (
    <span
      role="button"
      title={action.title ?? DEFAULT_TITLE[kind]}
      style={glyphStyle(hover, kind, draggable)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={draggable ? action.onPointerDown : undefined}
      onClick={action.onClick}
    >
      {GLYPH[kind]}
    </span>
  );
}

/** Render a set of pane actions as a bare fragment — the container places and wraps them. */
export function PaneActions({ actions }: { actions: readonly PaneAction[] }): ReactNode {
  return (
    <>
      {actions.map((a, i) => (
        <ActionGlyph key={`${a.kind}:${i}`} action={a} />
      ))}
    </>
  );
}
