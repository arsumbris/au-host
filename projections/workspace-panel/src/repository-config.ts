import { parseDocument } from 'yaml'

/** Read the current repo.yaml shape used by the existing workspace edit capability. */
export function parseRepoConfiguration(content: string): { identity: boolean; peers: string[]; error?: string } {
  const doc = parseDocument(content)
  if (doc.errors.length) return {identity:false, peers:[], error:doc.errors[0].message}
  const name = doc.get('name')
  const value = doc.toJS() as {deps?: unknown} | null
  const deps = value && Array.isArray(value.deps) ? value.deps : []
  const peers = deps.flatMap((dep: unknown) => typeof dep === 'string' ? [dep] : dep && typeof dep === 'object' && 'name' in dep && typeof dep.name === 'string' ? [dep.name] : [])
  return {identity:typeof name === 'string' && name.trim().length > 0, peers}
}
