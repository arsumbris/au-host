import { expect, it } from 'vitest'
import { displayFilePath } from '../src/file-label'
const members = [{name:'notes',root:'/home/private/vault'}, {name:'library',root:'/opt/library'}, {name:'nested',root:'/home/private/vault/nested'}]
it('shows relative paths without machine prefixes, including scattered and nested members', () => {
  expect(displayFilePath('/home/private/vault/docs/a.md',members)).toBe('notes / docs/a.md')
  expect(displayFilePath('/opt/library/a.md',members)).toBe('library / a.md')
  expect(displayFilePath('/home/private/vault/nested/a.md',members)).toBe('nested / a.md')
  expect(displayFilePath('docs/a.md',members)).toBe('docs/a.md')
})
it('does not mistake a common prefix or traversal for membership', () => {
  expect(displayFilePath('/home/private/vault-secret/a.md',members)).toBe('a.md · Outside workspace')
  expect(displayFilePath('/home/private/vault/../secret/a.md',members)).toBe('a.md · Outside workspace')
  expect(displayFilePath('../../secret/a.md',members)).toBe('a.md · Outside workspace')
})
it('handles Windows drives, UNC roots, trailing separators and root labels', () => {
  expect(displayFilePath('C:\\Users\\private\\Repo\\docs\\a.md',[{name:'project',root:'c:\\users\\private\\repo\\'}])).toBe('project / docs/a.md')
  expect(displayFilePath('\\\\server\\share\\a.md',[{name:'shared',root:'\\\\server\\share'}])).toBe('shared / a.md')
  expect(displayFilePath('/opt/library/',members)).toBe('library')
})
it('distinguishes duplicate filenames by their declared member names', () => {
  expect(displayFilePath('/home/private/vault/a.md',members)).not.toBe(displayFilePath('/opt/library/a.md',members))
})
