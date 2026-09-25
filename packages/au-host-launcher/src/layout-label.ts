import { UNSAVED_COMPOSITION } from '@arsumbris/au-host-sdk'

/** A workspace's layout label: its most recent composition's file name, or the unsaved one's name. */
export function layoutLabelOf(path: string | undefined): string | undefined {
  if (path === UNSAVED_COMPOSITION) return 'Unsaved layout'
  return path?.split(/[/\\]/).pop()?.replace(/\.(yaml|yml|md)$/, '')
}
