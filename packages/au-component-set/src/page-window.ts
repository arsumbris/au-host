export type PageItem = number | 'ellipsis'

/** Select edge pages and a moving neighborhood, then join the selected pages across gaps. */
export function pageWindow(page: number, count: number, siblings: number, boundaries: number): PageItem[] {
  if (!Number.isSafeInteger(count) || count < 1) return []
  const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const active = Number.isFinite(page) ? Math.min(count, Math.max(1, Math.floor(page))) : 1
  const radius = Math.min(count, nonnegative(siblings))
  const edges = Math.min(count, nonnegative(boundaries))
  const selected = new Set<number>()
  const include = (first: number, last: number) => {
    for (let value = first; value <= last; value++) selected.add(value)
  }

  include(1, edges)
  include(count - edges + 1, count)
  // Keep the neighborhood's length at either end of the document.
  const width = Math.min(count, radius * 2 + 1)
  let first = Math.max(1, active - radius)
  if (first + width - 1 > count) first = count - width + 1
  include(first, first + width - 1)

  const result: PageItem[] = []
  let previous: number | undefined
  for (const value of [...selected].sort((a, b) => a - b)) {
    if (previous !== undefined) {
      const omitted = value - previous - 1
      if (omitted === 1) result.push(previous + 1)
      else if (omitted > 1) result.push('ellipsis')
    }
    result.push(value)
    previous = value
  }
  return result
}
