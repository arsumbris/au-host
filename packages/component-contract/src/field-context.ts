/** Optional semantic contribution from a field to one control. Authored control semantics win.
 * Required is an accessibility hint; it does not enable native constraint validation.
 */
export interface FieldContext {
  readonly label?: string
  readonly description?: string
  readonly invalid?: boolean
  readonly required?: boolean
}

/** A control owns its focused node and any same-root semantic mirrors. A field never inspects them.
 * Clear only the contribution belonging to owner; stale cleanup must preserve a newer association.
 */
export interface FieldParticipant {
  setFieldContext(owner: object, context: FieldContext | null): void
  focus(options?: FocusOptions): void
}

export interface FieldAssociation {
  readonly owner: object
  readonly context: FieldContext
}

/** Pure ownership transition shared by participating implementations. Copies the context snapshot;
 * identical updates retain identity so a reactive control can avoid redundant render cycles.
 */
export function updateFieldAssociation(
  current: FieldAssociation | null,
  owner: object,
  context: FieldContext | null,
): FieldAssociation | null {
  if (context === null) return current?.owner === owner ? null : current
  if (current?.owner === owner && current.context.label === context.label &&
    current.context.description === context.description && current.context.invalid === context.invalid &&
    current.context.required === context.required) return current
  return { owner, context: { label: context.label, description: context.description, invalid: context.invalid, required: context.required } }
}
