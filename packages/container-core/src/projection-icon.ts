import { descriptorIcon, type ProjectionDescriptor } from '@arsumbris/au-host-sdk'

/** Resolve presentation from the descriptor set without confusing equally named peer types. */
export function projectionIconLookup(descriptors: readonly ProjectionDescriptor[]) {
  return (type: string | undefined): string => {
    if (!type) return 'panel-top'
    const [name, repo] = type.split('::')
    const matches = descriptors.filter(d => {
      const [candidate, qualifier] = d.type.split('::')
      return candidate === name && (!repo || (qualifier ?? d.repo) === repo)
    })
    return matches.length === 1 ? descriptorIcon(matches[0]) ?? 'panel-top' : 'panel-top'
  }
}

/** A file stays identifiable when its renderer changes between view and edit. */
export function tabContentIcon(file: unknown, projectionIcon: string): string {
  return typeof file === 'string' && file.trim().length > 0 ? 'file' : projectionIcon
}
