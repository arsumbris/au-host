/** Display only: file identity and I/O must keep the original path. */
export function displayFilePath(path: string, members: readonly { name: string; root: string }[] = []): string {
  const normalized = path.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
  if (!absolute && !normalized.split('/').includes('..')) return normalized
  const windows = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
  const comparable = (value: string) => windows ? value.toLowerCase() : value
  const candidate = comparable(normalized)
  const member = members.map(member => ({ ...member, root: member.root.replace(/\\/g, '/').replace(/\/+$/, '') }))
    .filter(member => candidate === comparable(member.root) || candidate.startsWith(comparable(member.root) + '/'))
    .sort((a, b) => b.root.length - a.root.length)[0]
  if (member && !normalized.split('/').includes('..')) {
    const relative = normalized.slice(member.root.length).replace(/^\/+/, '')
    return relative ? `${member.name} / ${relative}` : member.name
  }
  const name = normalized.split('/').filter(Boolean).at(-1) ?? 'File'
  return `${name} · Outside workspace`
}
