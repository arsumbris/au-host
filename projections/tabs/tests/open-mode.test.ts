// The open-disposition rule, tested in BOTH directions.
//
// Why both directions matter, and it is the reason this file exists rather than a single happy-path
// case: a default that ALWAYS wins and a default that NEVER applies look identical from one side.
// Assert only "no mode → the authored default" and an implementation ignoring the intent entirely
// passes. Assert only "explicit mode wins" and an implementation ignoring the default entirely
// passes. Each case below is the falsification of the other.

import { describe, expect, it } from 'vitest'

import { resolveOpenMode } from '../src/lib/open-mode.ts'

describe('resolveOpenMode', () => {
  describe('the firer had NO opinion — the container decides', () => {
    it('falls to the group’s authored default', () => {
      expect(resolveOpenMode(undefined, 'permanent')).toBe('permanent')
    })

    it('falls to transient when the group is unconfigured, so an unconfigured group is unchanged', () => {
      expect(resolveOpenMode(undefined, undefined)).toBe('transient')
    })

    it('honours an authored `transient` explicitly, not only by omission', () => {
      expect(resolveOpenMode(undefined, 'transient')).toBe('transient')
    })
  })

  describe('the firer WAS explicit — a gesture said so, and it always wins', () => {
    it('a double-click’s `permanent` wins over an authored transient', () => {
      expect(resolveOpenMode('permanent', 'transient')).toBe('permanent')
    })

    // The case that would break if the default were applied too eagerly: a group authored
    // `permanent` must still allow a single click to preview.
    it('a single-click’s `transient` wins over an authored permanent', () => {
      expect(resolveOpenMode('transient', 'permanent')).toBe('transient')
    })

    // `preview-pin` is not an authorable default, so it can only ever arrive from a gesture —
    // and it must survive whatever the group is configured to do.
    it('a cmd-click’s `preview-pin` survives both authored defaults', () => {
      expect(resolveOpenMode('preview-pin', 'permanent')).toBe('preview-pin')
      expect(resolveOpenMode('preview-pin', 'transient')).toBe('preview-pin')
    })

    it('an explicit mode wins with no default authored at all', () => {
      expect(resolveOpenMode('permanent', undefined)).toBe('permanent')
    })
  })
})
