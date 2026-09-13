import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitFrontmatter } from './frontmatter-source.ts'

test('typed YAML preserves dates, empty values, booleans and nested properties', () => {
  const result = splitFrontmatter('---\ndate: 2026-09-08\ncount: 0\nready: false\nempty: ""\nnone: null\nnested:\n  names: [one, two]\n---\n# Body\n')
  assert.deepEqual(result.data, { date: '2026-09-08', count: 0, ready: false, empty: '', none: null, nested: { names: ['one', 'two'] } })
  assert.equal(result.body, '# Body\n')
  assert.equal(result.invalid, undefined)
})

test('malformed and nonmapping metadata retain the exact authored text', () => {
  for (const source of ['title: [broken', '- one\n- two', 'plain text', 'null']) {
    const result = splitFrontmatter(`---\n${source}\n---\nBody`)
    assert.equal(result.data, null)
    assert.equal(result.invalid.source, source)
    assert.ok(result.invalid.message)
    assert.equal(result.body, 'Body')
  }
})

test('CRLF and empty metadata are handled without rewriting the body', () => {
  assert.equal(splitFrontmatter('---\r\na: 1\r\n---\r\nBody\r\n').body, 'Body\r\n')
  assert.deepEqual(splitFrontmatter('---\n\n---\nBody'), { data: null, body: 'Body' })
  for (const source of ['# Body\n', '---\na: 1\n', 'Body\n---\na: 1\n---\n']) assert.equal(splitFrontmatter(source).body, source)
})


test('frontmatter delimiters must occupy a complete line', () => {
  assert.deepEqual(splitFrontmatter('---\n---\nBody'), { data: null, body: 'Body' })
  assert.equal(splitFrontmatter('---\na: 1\n...\nBody').body, 'Body')
  assert.equal(splitFrontmatter('---  \na: 1\n---  \nBody').data.a, 1)
  const source = '---\na: 1\n---wrong\nBody'
  assert.equal(splitFrontmatter(source).body, source)
})
