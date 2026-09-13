export interface ReadSwitchState { path: string | null; dirty: boolean; saving: boolean; alive: boolean }

/** A view replacement may proceed only while the same document has a clean, settled buffer. */
export async function prepareRead(
  state: () => ReadSwitchState,
  confirmSave: () => Promise<boolean>,
  save: () => Promise<void>,
): Promise<string | null> {
  const start = { ...state() }
  if (!start.alive || !start.path || start.saving) return null
  if (start.dirty) {
    if (!await confirmSave()) return null
    const beforeSave = state()
    if (!beforeSave.alive || beforeSave.path !== start.path || beforeSave.saving) return null
    await save()
  }
  const end = state()
  return end.alive && end.path === start.path && !end.dirty && !end.saving ? start.path : null
}
