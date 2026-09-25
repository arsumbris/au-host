import { describe, it, expect } from 'vitest'
import { parseDocument } from 'yaml'
import { copyIntoRepo, requalifyKeymap, requalifyTarget } from './requalify'

describe('requalifyTarget', () => {
  it('a bare name from repo A names A in repo B', () => {
    expect(requalifyTarget('save-intent', 'intent', 'vault')).toBe('save-intent::intent')
  })
  it("a name qualified by the destination repo becomes bare, the destination's own form", () => {
    expect(requalifyTarget('note::vault', 'library', 'vault')).toBe('note')
  })
  it("a third repo's qualifier is kept", () => {
    expect(requalifyTarget('save-intent::intent', 'agent-sessions', 'vault')).toBe('save-intent::intent')
  })
  it('a pin travels with its repo; a pin on the source repo is qualified with it', () => {
    expect(requalifyTarget('note::@abc123', 'library', 'vault')).toBe('note::library@abc123')
    expect(requalifyTarget('note::library@abc123', 'x', 'library')).toBe('note::@abc123')
  })
  it('fragments stay after the scope', () => {
    expect(requalifyTarget('note#Heading', 'library', 'vault')).toBe('note::library#Heading')
    expect(requalifyTarget('note::vault^b1', 'library', 'vault')).toBe('note^b1')
  })
})

const SOURCE = `# a shipped keymap
type: keymap
when:
  - "[[reader]]"
keybinds:
  - chord: [{ key: s, mods: [mod] }]
    intent: "[[save-intent]]" # save
  - chord: [{ key: p, mods: [mod, shift] }]
    intent: "[[toggle-command-palette-intent::intent]]"
    when: ["[[editor-pane::app]]"]
`

describe('requalifyKeymap', () => {
  it('rewrites the claim, the scope and every keybind reference for the destination repo', () => {
    const doc = parseDocument(SOURCE)
    requalifyKeymap(doc, 'intent', 'app')
    const out = doc.toJS()
    expect(out.type).toBe('keymap::intent')
    expect(out.when).toEqual(['[[reader::intent]]'])
    expect(out.keybinds[0].intent).toBe('[[save-intent::intent]]')
    expect(out.keybinds[1].intent).toBe('[[toggle-command-palette-intent::intent]]')
    expect(out.keybinds[1].when).toEqual(['[[editor-pane]]'])
  })
  it('keeps comments and chords as written', () => {
    const doc = parseDocument(SOURCE)
    requalifyKeymap(doc, 'intent', 'app')
    const text = doc.toString()
    expect(text).toContain('# a shipped keymap')
    expect(text).toContain('# save')
    expect(doc.toJS().keybinds[0].chord).toEqual([{ key: 's', mods: ['mod'] }])
  })
  it('a copy within one repo changes nothing', () => {
    const doc = parseDocument(SOURCE)
    requalifyKeymap(doc, 'intent', 'intent')
    expect(doc.toString()).toBe(parseDocument(SOURCE).toString())
  })
})

describe('copyIntoRepo', () => {
  it('writes the rewritten keymap to the destination, never touching the source', async () => {
    const written = new Map<string, string>()
    const files = {
      read: async (path: string) => (path === '/intent/k.keymap.yaml' ? { ok: true, content: SOURCE, hash: 'h' } : { ok: false }),
      write: async (path: string, content: string) => (written.set(path, content), { ok: true }),
    } as unknown as Parameters<typeof copyIntoRepo>[0]
    const res = await copyIntoRepo(files, '/intent/k.keymap.yaml', '/app/k-local.keymap.yaml', 'intent', 'app')
    expect(res).toEqual({ ok: true })
    expect([...written.keys()]).toEqual(['/app/k-local.keymap.yaml'])
    expect(parseDocument(written.get('/app/k-local.keymap.yaml')!).toJS().keybinds[0].intent).toBe('[[save-intent::intent]]')
  })
  it('an unreadable source copies nothing', async () => {
    const files = { read: async () => ({ ok: false }), write: async () => ({ ok: true }) } as unknown as Parameters<typeof copyIntoRepo>[0]
    expect((await copyIntoRepo(files, '/a', '/b', 'x', 'y')).ok).toBe(false)
  })
})
