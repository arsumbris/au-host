import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fileSelection, folderSelection } from '@arsumbris/selection'

import { currentPath, followMove, moveRefusal, nameProblem } from '../src/move-refusal.ts'

test('refuses a folder into itself or any descendant', () => {
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws/src'), 'into-itself')
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws/src/sub'), 'into-itself')
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws/src/sub/deep'), 'into-itself')
})
test('treats its own parent as already there', () => {
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws'), 'already-there')
  assert.equal(moveRefusal(fileSelection('/ws/src/a.md'), '/ws/src'), 'already-there')
})
test('does not mistake a sibling sharing a prefix for a descendant', () => {
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws/srcfoo'), null)
})
test('allows a real move', () => {
  assert.equal(moveRefusal(folderSelection('/ws/src'), '/ws/dest'), null)
  assert.equal(moveRefusal(fileSelection('/ws/src/a.md'), '/ws/dest'), null)
})
test('a move preview path inside the moved folder maps back to where it is now', () => {
  assert.equal(currentPath('/ws/dest/src/a.md', '/ws/src', '/ws/dest/src'), '/ws/src/a.md')
  assert.equal(currentPath('/ws/by-path.md', '/ws/src', '/ws/dest/src'), '/ws/by-path.md')
  assert.equal(currentPath('/ws/dest/srcfoo/a.md', '/ws/src', '/ws/dest/src'), '/ws/dest/srcfoo/a.md')
})
test('a name with a slash, a dot name, or nothing is refused', () => {
  assert.notEqual(nameProblem(''), null)
  assert.notEqual(nameProblem('a/b'), null)
  assert.notEqual(nameProblem('.'), null)
  assert.notEqual(nameProblem('..'), null)
  assert.equal(nameProblem('lib'), null)
  assert.equal(nameProblem('.hidden'), null)
})
test('expanded folders follow a moved folder, and nothing else changes', () => {
  const after = followMove(new Set(['/ws', '/ws/src', '/ws/src/sub', '/ws/srcfoo']), '/ws/src', '/ws/dest/src')
  assert.deepEqual([...after].sort(), ['/ws', '/ws/dest/src', '/ws/dest/src/sub', '/ws/srcfoo'])
})
