// Projection labels resolve in order: authored slot label, declared projection title, then
// a name derived from the type identifier. These tests protect that precedence and empty-slot behavior.

import { describe, expect, it } from 'vitest';

import {
  descriptorLabel,
  positionName,
  projectionLabel,
  projectionTitleLookup,
} from '../src/projection-label.ts';

const PRESENTATION = 'projection-presentation-meta';
const descriptor = (type: string, title?: string): { type: string; meta?: Record<string, Record<string, unknown>> } =>
  title ? { type, meta: { [PRESENTATION]: { title } } } : { type };

describe('projectionLabel — the fallback derivation, OVERRIDES table gone', () => {
  it('derives from the type name and no longer hardcodes a curated label', () => {
    // The derivation shows `File Tree`. The curated name comes from the
    // declared title instead (see positionName / descriptorLabel below).
    expect(projectionLabel('file-tree')).toBe('File Tree');
    expect(projectionLabel('editor-pane')).toBe('Editor Pane');
    expect(projectionLabel('reader-kit')).toBe('Reader'); // -kit names packaging, dropped
  });

  it('strips ::repo and returns empty for an absent type', () => {
    expect(projectionLabel('type-list::type-list')).toBe('Type List');
    expect(projectionLabel(undefined)).toBe('');
  });
});

describe('projectionTitleLookup — resolve a declared title by occupant type', () => {
  const lookup = projectionTitleLookup([
    descriptor('editor-pane', 'Editor'),
    descriptor('file-tree', 'Files'),
    descriptor('plain-pane'), // declares no title
  ]);

  it('returns the declared title, keyed by bare name so a ::repo occupant resolves', () => {
    expect(lookup('editor-pane')).toBe('Editor');
    expect(lookup('file-tree::file-tree')).toBe('Files');
  });

  it('is undefined for a titleless or unknown projection', () => {
    expect(lookup('plain-pane')).toBeUndefined();
    expect(lookup('never-heard-of-it')).toBeUndefined();
    expect(lookup(undefined)).toBeUndefined();
  });

  it('tolerates an absent descriptor set', () => {
    expect(projectionTitleLookup(undefined)('editor-pane')).toBeUndefined();
  });
});

describe('positionName — slot.label > declaredTitle > derivation', () => {
  it('an authored slot label outranks the declared title', () => {
    expect(positionName({ label: 'Sidebar' }, 'editor-pane', 'Editor')).toBe('Sidebar');
  });

  it('the declared title outranks the derivation', () => {
    expect(positionName(null, 'file-tree', 'Files')).toBe('Files');
  });

  it('falls through to the derivation when no label and no declared title', () => {
    expect(positionName(null, 'file-tree')).toBe('File Tree');
  });

  it('returns empty for an unlabelled empty position, so a caller keeps || "empty"', () => {
    expect(positionName(null, undefined)).toBe('');
  });
});

describe('descriptorLabel — declared title with a derivation fallback', () => {
  it('prefers the declared title', () => {
    expect(descriptorLabel(descriptor('file-tree', 'Files'))).toBe('Files');
  });

  it('falls back to the derivation when no title is declared', () => {
    expect(descriptorLabel(descriptor('file-tree'))).toBe('File Tree');
    expect(descriptorLabel(undefined, 'scope-panel')).toBe('Scope Panel');
  });
});
