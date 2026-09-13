// VIEWER RESOLUTION — which projection opens a file, resolved through an EXPLICIT ladder, never an
// implicit default. `opens-meta` declares ELIGIBILITY only (`viewersFor`); the DECISION is the firer's
// `open-intent.with`, then a composition `viewer-defaults`, then the sole eligible viewer, else a
// must-pick. These pin that there is NO silent specificity auto-pick: a bare `editor` (declares `*`) and
// a `reader` (declares `md`) are BOTH eligible for markdown, so md MUST-PICKS unless a default decides.

import { describe, expect, it } from 'vitest';

import { extensionOf, resolveViewer, viewerPickOptions, viewersFor } from '../src/viewer-resolve.ts';

const d = (type: string, opens?: string[]): { type: string; meta?: Record<string, Record<string, unknown>> } =>
  opens ? { type, meta: { 'opens-meta': { opens } } } : { type };

describe('extensionOf', () => {
  it('takes the last extension, lowercased, no dot', () => {
    expect(extensionOf('notes/x.md')).toBe('md');
    expect(extensionOf('A/B/C.MD')).toBe('md');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });
  it('is empty for no extension (a dotfile is not an extension)', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('resolveViewer — the explicit ladder', () => {
  const editor = d('editor-pane', ['*']);
  const reader = d('aup-reader', ['md', 'markdown', 'mdx']);

  it('1. the firer’s `with` wins, unconditionally', () => {
    expect(resolveViewer('readme.md', [editor, reader], { with: 'aup-reader' })).toEqual({ viewer: 'aup-reader' });
    // `with` beats a composition default too.
    expect(
      resolveViewer('readme.md', [editor, reader], { with: 'aup-reader', viewerDefaults: [{ opens: 'md', viewer: 'editor-pane' }] }),
    ).toEqual({ viewer: 'aup-reader' });
  });

  it('2. a composition default decides an otherwise-ambiguous open (no silent specificity)', () => {
    // The composition viewer default takes precedence when several viewers can open md.
    expect(resolveViewer('readme.md', [editor, reader], { viewerDefaults: [{ opens: 'md', viewer: 'editor-pane' }] })).toEqual({
      viewer: 'editor-pane',
    });
    // `*` matches any kind.
    expect(resolveViewer('readme.md', [editor, reader], { viewerDefaults: [{ opens: '*', viewer: 'aup-reader' }] })).toEqual({
      viewer: 'aup-reader',
    });
  });

  it('2b. a default whose viewer is NOT eligible for the file is ignored', () => {
    // reader does not open .ts, so a md->reader default cannot apply, and .ts has a sole eligible (editor).
    expect(resolveViewer('x.ts', [editor, reader], { viewerDefaults: [{ opens: 'ts', viewer: 'aup-reader' }] })).toEqual({
      viewer: 'editor-pane',
    });
  });

  it('3. the sole eligible viewer opens directly — the only door, not a default', () => {
    expect(resolveViewer('x.ts', [editor, reader])).toEqual({ viewer: 'editor-pane' }); // reader opens only md*
    expect(resolveViewer('x.md', [reader])).toEqual({ viewer: 'aup-reader' });
  });

  it('4. two-plus eligible with no resolution → MUST-PICK the eligible set (no auto-pick)', () => {
    // With multiple eligible viewers and no configured choice, ask the user to select one.
    expect(resolveViewer('readme.md', [editor, reader])).toEqual({ mustPick: ['aup-reader', 'editor-pane'] });
  });

  it('4b. no eligible viewer → MUST-PICK empty (the caller declines)', () => {
    expect(resolveViewer('x.ts', [reader])).toEqual({ mustPick: [] }); // reader opens only md*
    expect(resolveViewer('x.ts', [d('plain-pane')])).toEqual({ mustPick: [] }); // no opens-meta
    expect(resolveViewer('x.ts', undefined)).toEqual({ mustPick: [] });
    expect(resolveViewer('x.ts', [])).toEqual({ mustPick: [] });
  });

  it('a ::repo-qualified descriptor resolves to its bare name in the eligible set', () => {
    expect(resolveViewer('x.md', [d('aup-reader::aup-reader', ['md'])])).toEqual({ viewer: 'aup-reader' });
  });
});

// viewersFor — the WHOLE candidate list (file-tree's "Open with ›" + the picker use it), most-specific
// FIRST for DISPLAY order. It stays the eligibility fold; nothing auto-selects `[0]` any longer.
describe('viewersFor', () => {
  const editor = d('editor-pane', ['*']);
  const reader = d('aup-reader', ['md', 'markdown', 'mdx']);

  it('lists specific viewers BEFORE universal ones, deterministically regardless of input order', () => {
    expect(viewersFor('notes/readme.md', [editor, reader])).toEqual(['aup-reader', 'editor-pane']);
    expect(viewersFor('notes/readme.md', [reader, editor])).toEqual(['aup-reader', 'editor-pane']);
  });

  it('a non-markdown file lists only the universal viewer', () => {
    expect(viewersFor('notes/x.ts', [editor, reader])).toEqual(['editor-pane']);
  });

  it('is empty when nothing declares it opens the file', () => {
    expect(viewersFor('notes/x.ts', [reader])).toEqual([]); // reader only opens md*
    expect(viewersFor('notes/x.ts', [d('plain-pane')])).toEqual([]); // no opens-meta
    expect(viewersFor('notes/x.ts', undefined)).toEqual([]);
    expect(viewersFor('notes/x.ts', [])).toEqual([]);
  });
});

// viewerPickOptions — the chooser option list for a viewer must-pick. Preserves candidate order and
// labels each with its DECLARED title (projection-presentation-meta), falling back to the bare name.
describe('viewerPickOptions', () => {
  const withTitle = (type: string, title: string): { type: string; meta?: Record<string, Record<string, unknown>> } => ({
    type,
    meta: { 'projection-presentation-meta': { title } },
  });

  it('labels each candidate with its declared title, in candidate order', () => {
    const descriptors = [withTitle('aup-reader', 'Reader'), withTitle('editor-pane', 'Editor')];
    expect(viewerPickOptions(['aup-reader', 'editor-pane'], descriptors)).toEqual([
      { id: 'aup-reader', label: 'Reader' },
      { id: 'editor-pane', label: 'Editor' },
    ]);
  });

  it('falls back to the bare type name when no title is declared, or the descriptor is missing', () => {
    expect(viewerPickOptions(['editor-pane'], [{ type: 'editor-pane' }])).toEqual([{ id: 'editor-pane', label: 'editor-pane' }]);
    expect(viewerPickOptions(['ghost'], undefined)).toEqual([{ id: 'ghost', label: 'ghost' }]);
  });

  it('matches a candidate against a ::repo-qualified descriptor by bare name', () => {
    expect(viewerPickOptions(['aup-reader'], [withTitle('aup-reader::aup-reader', 'Reader')])).toEqual([
      { id: 'aup-reader', label: 'Reader' },
    ]);
  });
});
