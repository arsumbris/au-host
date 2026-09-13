import { parseYamlDocuments, TaggedYamlValue } from './yaml-documents.ts'

export interface FrontmatterSource {
  data: Record<string, unknown> | null
  body: string
  invalid?: { source: string; message: string }
}

/** Preserve invalid authored metadata alongside the readable document body. */
export function splitFrontmatter(source: string): FrontmatterSource {
  const match = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match) return { data: null, body: source }
  const body = source.slice(match[0].length)
  const metadata = match[1]!.replace(/\r?\n$/, '')
  try {
    const result = parseYamlDocuments(metadata)
    if (result.error) return { data: null, body, invalid: { source: metadata, message: result.error } }
    const parsed = result.documents[0]
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !(parsed instanceof Map) && !(parsed instanceof TaggedYamlValue)) {
      return { data: parsed as Record<string, unknown>, body }
    }
    if (parsed == null && !metadata.trim()) return { data: null, body }
    return { data: null, body, invalid: { source: metadata, message: 'Properties require an untagged YAML mapping with text keys.' } }
  } catch (error) {
    return { data: null, body, invalid: { source: metadata, message: error instanceof Error ? error.message : 'The properties could not be read as YAML.' } }
  }
}
