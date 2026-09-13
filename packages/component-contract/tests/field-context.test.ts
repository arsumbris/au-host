import { describe, expect, it } from 'vitest'
import { updateFieldAssociation } from '../src/field-context'

describe('field contribution ownership', () => {
  it('preserves a newer field when the previous field releases a moved control', () => {
    const first = {}, second = {}
    const initial = updateFieldAssociation(null, first, {label:'First'})
    const moved = updateFieldAssociation(initial, second, {label:'Second', description:'New help'})
    expect(updateFieldAssociation(moved, first, null)).toBe(moved)
    expect(updateFieldAssociation(moved, second, null)).toBeNull()
  })
  it('copies a producer snapshot instead of keeping its mutable object', () => {
    const context = {label:'Original'}
    const state = updateFieldAssociation(null, {}, context)
    context.label = 'Later mutation'
    expect(state?.context.label).toBe('Original')
  })
  it('retains identity for identical updates and distinguishes clearing semantic contributions', () => {
    const owner = {}
    const state = updateFieldAssociation(null, owner, {label:'Name', invalid:true, required:true})
    expect(updateFieldAssociation(state, owner, {label:'Name', invalid:true, required:true})).toBe(state)
    const cleared = updateFieldAssociation(state, owner, {label:'Name'})
    expect(cleared).not.toBe(state)
    expect(cleared?.context.invalid).toBeUndefined()
    expect(cleared?.context.required).toBeUndefined()
  })
})
