// A menu and its successor picker may briefly overlap. Each interaction owns a lease,
// so closing one cannot fold the frame while the other is still in use.
const holds = new WeakMap<HTMLElement, number>()

export function holdPaneFrame(from: HTMLElement): () => void {
  const frame = from.closest('au-pane-frame') as (HTMLElement & { engaged: boolean }) | null
  if (!frame) return () => {}
  holds.set(frame, (holds.get(frame) ?? 0) + 1)
  frame.engaged = true
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (holds.get(frame) ?? 1) - 1
    if (remaining) holds.set(frame, remaining)
    else { holds.delete(frame); frame.engaged = false }
  }
}
