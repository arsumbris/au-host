import type { Tabs } from '../generated'

/** Only new file tabs use this policy; activation, preview reuse and explicit drop positions do not. */
export function newFileTabIndex(count: number, activeIndex: number, sourceIndex: number, position?: Tabs['newTabPosition']): number {
  const anchor = sourceIndex >= 0 && sourceIndex < count ? sourceIndex : Math.max(0, Math.min(activeIndex, count))
  return Math.min(count, anchor + (position === 'after-source' ? 1 : 0))
}
