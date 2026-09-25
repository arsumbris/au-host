import { memberOfPath } from './member-path'

/** Display only: file identity and I/O must keep the original path. */
export function displayFilePath(path: string, members: readonly { name: string; root: string }[] = []): string {
  const normalized = path.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
  if (!absolute && !normalized.split('/').includes('..')) return normalized
  const member = normalized.split('/').includes('..') ? undefined : memberOfPath(members, normalized)
  if (member) {
    const root = member.root.replace(/\\/g, '/').replace(/\/+$/, '')
    const relative = normalized.slice(root.length).replace(/^\/+/, '')
    return relative ? `${member.name} / ${relative}` : member.name
  }
  const name = normalized.split('/').filter(Boolean).at(-1) ?? 'File'
  return `${name} · Outside workspace`
}
