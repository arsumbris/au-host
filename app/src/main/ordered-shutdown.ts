/** Session owners finish while their lifecycle services are still available. */
export async function orderedShutdown(drain: () => Promise<boolean>, dispose: () => void): Promise<boolean> {
  if (!await drain()) return false
  dispose()
  return true
}
