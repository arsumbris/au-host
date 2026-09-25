import { describe, it, expect, vi, beforeEach } from 'vitest'

// Count the underlying reads: the whole point is that a warm open issues ZERO reads, and one read
// warms every type. Mock the engine-reads seam so we assert read COUNT, not timing (a wall-clock
// assertion would be env-flaky — green-check traps #7/#8).
const readInstanceCounts = vi.fn()
vi.mock('@arsumbris/au-host-sdk/engine-reads', () => ({
  readInstanceCounts: (...args: unknown[]) => readInstanceCounts(...args),
}))

import { fileInstanceCount, invalidateInstanceCounts } from './instance-count-cache'

/** One `by_type` row: a type identity, the repos owning it, and its count. */
type Row = { name: string; owners: string[]; count: number }
const row = (name: string, owner: string, count: number): Row => ({ name, owners: [owner], count })
const counts = (...rows: Row[]) => ({
  ready: true,
  result: {
    aborted_at_load: false,
    total: 0,
    by_type: rows.map((r) => ({ name: r.name, hash: `${r.name}@${r.owners[0]}`, type_owners: r.owners, count: r.count })),
  },
})
const later = <T>(value: T, ms = 5): Promise<T> => new Promise((res) => setTimeout(() => res(value), ms))
/** A def's own identity, by the repo that owns it. */
const id = (name: string, owner = 'notes') => ({ name, owner })
/** A resolved claim's identity, by the hash the engine put on the token (the fixture hash is `name@owner`). */
const claim = (name: string, owner: string) => ({ name, hash: `${name}@${owner}` })

// The cache keys by the reader object identity, so any object stands in as an opaque reader key.
type Reader = Parameters<typeof fileInstanceCount>[0]
const reader = (): Reader => ({}) as unknown as Reader
let engine: Reader
beforeEach(() => {
  readInstanceCounts.mockReset()
  engine = reader()
})

describe('fileInstanceCount', () => {
  it('reads the file-only count for the identity', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 2000), row('task', 'notes', 500)))
    expect(await fileInstanceCount(engine, id('note'))).toBe(2000)
    // origins:['file'] is passed as the 4th positional arg.
    expect(readInstanceCounts).toHaveBeenCalledWith(engine, undefined, undefined, ['file'])
  })

  it('a resolved claim joins its row by (name, hash) (the regression: a qualified claim read 0)', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('composition', 'au-host-sdk', 89)))
    expect(await fileInstanceCount(engine, claim('composition', 'au-host-sdk'))).toBe(89)
  })

  it('same-named types in different repos are different identities, by hash and by owner', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 7), row('note', 'library', 40)))
    expect(await fileInstanceCount(engine, claim('note', 'notes'))).toBe(7)
    expect(await fileInstanceCount(engine, claim('note', 'library'))).toBe(40)
    expect(await fileInstanceCount(engine, id('note', 'notes'))).toBe(7)
    expect(await fileInstanceCount(engine, id('note', 'library'))).toBe(40)
  })

  it('a hash no row carries counts 0, never another identity of the same name', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'library', 40)))
    expect(await fileInstanceCount(engine, claim('note', 'notes'))).toBe(0)
  })

  it('an identity owned by several repos is found from each', async () => {
    readInstanceCounts.mockResolvedValue(counts({ name: 'note', owners: ['a', 'b'], count: 3 }))
    expect(await fileInstanceCount(engine, id('note', 'a'))).toBe(3)
    expect(await fileInstanceCount(engine, id('note', 'b'))).toBe(3)
  })

  it('one read warms EVERY type (subsequent lookups issue no read)', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 2000), row('task', 'notes', 500)))
    expect(await fileInstanceCount(engine, id('note'))).toBe(2000)
    expect(await fileInstanceCount(engine, id('task'))).toBe(500)
    expect(await fileInstanceCount(engine, id('note'))).toBe(2000)
    expect(readInstanceCounts).toHaveBeenCalledTimes(1)
  })

  it('concurrent misses COALESCE to a single read (N panes, one read)', async () => {
    readInstanceCounts.mockReturnValue(later(counts(row('note', 'notes', 2000), row('task', 'notes', 500))))
    const [a, b, c] = await Promise.all([
      fileInstanceCount(engine, id('note')),
      fileInstanceCount(engine, id('task')),
      fileInstanceCount(engine, id('note')),
    ])
    expect(readInstanceCounts).toHaveBeenCalledTimes(1)
    expect([a, b, c]).toEqual([2000, 500, 2000])
  })

  it('an identity with no instances counts zero', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 2000)))
    expect(await fileInstanceCount(engine, id('nope'))).toBe(0)
  })

  it('a not-ready read is unknown, not zero, and is not cached', async () => {
    readInstanceCounts.mockResolvedValueOnce({ ready: false }).mockResolvedValueOnce(counts(row('note', 'notes', 2)))
    expect(await fileInstanceCount(engine, id('note'))).toBeUndefined()
    expect(await fileInstanceCount(engine, id('note'))).toBe(2)
    expect(readInstanceCounts).toHaveBeenCalledTimes(2)
  })

  it('a failed read is unknown and is not cached', async () => {
    readInstanceCounts.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValueOnce(counts(row('note', 'notes', 2)))
    expect(await fileInstanceCount(engine, id('note'))).toBeUndefined()
    expect(await fileInstanceCount(engine, id('note'))).toBe(2)
  })

  it('invalidate drops the cache so the next call re-reads (a rebuild changed the counts)', async () => {
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 2000)))
    await fileInstanceCount(engine, id('note'))
    invalidateInstanceCounts(engine)
    await fileInstanceCount(engine, id('note'))
    expect(readInstanceCounts).toHaveBeenCalledTimes(2)
  })

  it('a read in flight when the graph changed is never stored as current', async () => {
    readInstanceCounts
      .mockReturnValueOnce(later(counts(row('note', 'notes', 1)), 10)) // the old graph
      .mockReturnValueOnce(later(counts(row('note', 'notes', 2)), 1)) // after the rebuild
    const stale = fileInstanceCount(engine, id('note'))
    invalidateInstanceCounts(engine) // a rebuild lands while the first read is in flight
    expect(await fileInstanceCount(engine, id('note'))).toBe(2)
    expect(await stale).toBe(1) // the waiting caller still gets its answer
    expect(await fileInstanceCount(engine, id('note'))).toBe(2) // but the cache holds the new graph
    expect(readInstanceCounts).toHaveBeenCalledTimes(2)
  })

  it('invalidate is scoped to its reader (another reader keeps its warm cache)', async () => {
    const other = reader()
    readInstanceCounts.mockResolvedValue(counts(row('note', 'notes', 2000)))
    await fileInstanceCount(engine, id('note'))
    await fileInstanceCount(other, id('note'))
    invalidateInstanceCounts(engine)
    await fileInstanceCount(other, id('note')) // still warm → no new read
    expect(readInstanceCounts).toHaveBeenCalledTimes(2)
  })
})
