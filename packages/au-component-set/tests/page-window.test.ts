import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageWindow } from '../src/page-window.ts'

test('short documents, empty documents and edge neighborhoods', () => {
  assert.deepEqual(pageWindow(1, 0, 1, 1), [])
  assert.deepEqual(pageWindow(1, 1, 1, 1), [1])
  assert.deepEqual(pageWindow(3, 5, 1, 1), [1, 2, 3, 4, 5])
  assert.deepEqual(pageWindow(1, 20, 1, 1), [1, 2, 3, 'ellipsis', 20])
  assert.deepEqual(pageWindow(20, 20, 1, 1), [1, 'ellipsis', 18, 19, 20])
  assert.deepEqual(pageWindow(10, 20, 1, 1), [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20])
})

test('single missing pages stay clickable; unpinned edges and custom neighborhoods', () => {
  assert.deepEqual(pageWindow(4, 10, 1, 1), [1, 2, 3, 4, 5, 'ellipsis', 10])
  assert.deepEqual(pageWindow(5, 20, 0, 0), [5])
  assert.deepEqual(pageWindow(5, 20, 2, 2), [1, 2, 3, 4, 5, 6, 7, 'ellipsis', 19, 20])
  assert.deepEqual(pageWindow(-3, 5, NaN, 1), [1, 'ellipsis', 5])
  assert.deepEqual(pageWindow(1, Infinity, 1, 1), [])
})

test('every page remains reachable with sorted unique valid pages and meaningful gaps', () => {
  for (let count = 1; count <= 80; count++) {
    for (let page = 1; page <= count; page++) {
      for (const radius of [0, 1, 2, 4]) {
        const items = pageWindow(page, count, radius, 1)
        const pages = items.filter((item): item is number => typeof item === 'number')
        assert(pages.includes(page)); assert(pages.includes(1)); assert(pages.includes(count))
        assert.equal(new Set(pages).size, pages.length)
        assert.deepEqual(pages, [...pages].sort((a, b) => a - b))
        assert(pages.every(value => value >= 1 && value <= count))
        for (let i = 0; i < items.length; i++) {
          if (items[i] !== 'ellipsis') continue
          assert.equal(typeof items[i - 1], 'number'); assert.equal(typeof items[i + 1], 'number')
          assert((items[i + 1] as number) - (items[i - 1] as number) > 2)
        }
      }
    }
  }
})
