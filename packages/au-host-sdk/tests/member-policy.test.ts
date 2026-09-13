import { describe, expect, it } from 'vitest'

import { isAuthoringMember, isWritableMember } from '../src/index.ts'
import type { WorkspaceMember, WorkspaceMemberRole } from '../src/index.ts'

// The two policies over the engine's two orthogonal member axes (schema 16):
//   `editable` — ROLE axis: an authoring surface (entry / edit) vs consumed (dep / discover).
//   `local`    — LOCATION axis: a live working tree vs a read-only cache snapshot.
//
// These unit tests distinguish the policies when an edit member is not local. A cache-resolved `edit` member is the whole reason `isWritableMember`
// exists, and there is no fixture producing one. See the end-to-end fixture requirements at the bottom.

const member = (role: WorkspaceMemberRole, editable: boolean, local: boolean): WorkspaceMember => ({
  name: `${role}-member`,
  root: `/abs/${role}`,
  scattered: false,
  editable,
  local,
  role,
})

// The four roles as the engine actually serves them, confirmed against a live schema-16 daemon.
const ENTRY = member('entry', true, true)
const EDIT = member('edit', true, true)
const DISCOVER = member('discover', false, true)
const DEP = member('dep', false, true)
// The case with no dogfood fixture: yours to author, but resolved read-only from the package cache.
const EDIT_CACHED = member('edit', true, false)

describe('isAuthoringMember — the DISPLAY policy', () => {
  it('accepts the authoring surfaces: the entry and edit members', () => {
    expect(isAuthoringMember(ENTRY)).toBe(true)
    expect(isAuthoringMember(EDIT)).toBe(true)
  })

  it('rejects consumed members, whether mounted for discovery or as a dependency', () => {
    expect(isAuthoringMember(DISCOVER)).toBe(false)
    expect(isAuthoringMember(DEP)).toBe(false)
  })

  it('ignores WHERE the member resolved — the role axis is independent of location', () => {
    // An edit member served from the cache is still yours, so it still lists as an authoring
    // surface. Hiding it from the tree because of where it resolved would be wrong.
    expect(isAuthoringMember(EDIT_CACHED)).toBe(true)
  })
})

describe('isWritableMember — the SAVE-TARGETING policy', () => {
  it('accepts an authoring surface that is a live local tree', () => {
    expect(isWritableMember(ENTRY)).toBe(true)
    expect(isWritableMember(EDIT)).toBe(true)
  })

  it('rejects consumed members even though they are local', () => {
    expect(isWritableMember(DISCOVER)).toBe(false)
    expect(isWritableMember(DEP)).toBe(false)
  })

  it('REJECTS a cache-resolved edit member — the reason this policy is separate', () => {
    // Save-as destinations must distinguish members owned by the workspace from members writable in place.
    expect(isWritableMember(EDIT_CACHED)).toBe(false)
    // ...and it is precisely where the two policies diverge.
    expect(isAuthoringMember(EDIT_CACHED)).toBe(true)
  })
})

describe('the two policies', () => {
  it('coincide on every member whose location is local', () => {
    // Why the distinction is invisible in the dogfood: with `local: true` everywhere, the stricter
    // policy is indistinguishable from the looser one. A GUI check cannot tell them apart there.
    for (const m of [ENTRY, EDIT, DISCOVER, DEP]) {
      expect(isWritableMember(m)).toBe(isAuthoringMember(m))
    }
  })

  it('diverge only when an authoring surface is non-local', () => {
    expect(isAuthoringMember(EDIT_CACHED)).not.toBe(isWritableMember(EDIT_CACHED))
  })

  it('are structural, so a raw wire member works without mapping', () => {
    // Both take the minimum shape, so a `WireMember` off the `members` read can be filtered
    // directly without first mapping it into a `WorkspaceMember`.
    expect(isAuthoringMember({ editable: true })).toBe(true)
    expect(isWritableMember({ editable: true, local: false })).toBe(false)
  })
})

// These unit fixtures exercise local: false. End-to-end verification requires an edit member
// resolved from a package-cache snapshot, absent from sibling paths and the device registry.
