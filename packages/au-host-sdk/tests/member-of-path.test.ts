import { describe, expect, it } from 'vitest'
import { memberOfPath } from '../src/index.ts'

const m = (name: string, root: string) => ({ name, root })
const members = [m('ws', '/w'), m('notes', '/w/notes'), m('lib', '/libs/lib'), m('libx', '/libs/libx/')]

describe('memberOfPath', () => {
  it('owns its own root', () => {
    expect(memberOfPath(members, '/w/notes')?.name).toBe('notes')
  })
  it('the deepest nested root wins', () => {
    expect(memberOfPath(members, '/w/notes/a/b.md')?.name).toBe('notes')
    expect(memberOfPath(members, '/w/other.md')?.name).toBe('ws')
  })
  it('a root owns whole segments only, never a sibling sharing its prefix', () => {
    expect(memberOfPath(members, '/libs/libx/a.md')?.name).toBe('libx')
    expect(memberOfPath(members, '/libs/lib/a.md')?.name).toBe('lib')
    expect(memberOfPath([m('lib', '/libs/lib')], '/libs/libx/a.md')).toBeUndefined()
  })
  it('a trailing slash on a root is ignored', () => {
    expect(memberOfPath(members, '/libs/libx')?.name).toBe('libx')
  })
  it('no member contains the path', () => {
    expect(memberOfPath(members, '/elsewhere/x.md')).toBeUndefined()
  })
  it('a relative path is placed under the entry, as the engine resolves it', () => {
    expect(memberOfPath(members, 'notes/a.md', '/w')?.name).toBe('notes')
    expect(memberOfPath(members, 'other.md', '/w')?.name).toBe('ws')
    expect(memberOfPath(members, './notes/a.md', '/w/')?.name).toBe('notes')
  })
  it('a relative path with no entry to place it has no owner', () => {
    expect(memberOfPath(members, 'notes/a.md')).toBeUndefined()
  })
  it('dot segments resolve before the comparison', () => {
    expect(memberOfPath(members, '/w/notes/../other.md')?.name).toBe('ws')
    expect(memberOfPath(members, '../libs/lib/a.md', '/w')?.name).toBe('lib')
  })
  it('Windows paths compare with forward slashes, case-folded', () => {
    const win = [m('ws', 'C:\\Work\\ws'), m('notes', 'c:/work/ws/Notes')]
    expect(memberOfPath(win, 'C:\\work\\WS\\Notes\\a.md')?.name).toBe('notes')
    expect(memberOfPath(win, 'c:/WORK/ws/b.md')?.name).toBe('ws')
  })
})
