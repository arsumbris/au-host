import { useMemo, type ReactNode } from 'react'
import { parseYamlDocuments, TaggedYamlValue } from './yaml-documents'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { Frontmatter, PropertyValue } from './frontmatter'

/** Structured values accompany the authored YAML; they never replace or rewrite it. */
export function YamlPreview({ source, host, path, renderText, renderType }: {
  source: string; host: MountHost; path: string | null
  renderText: (text: string) => ReactNode; renderType: (claim: string) => ReactNode
}) {
  const parsed = useMemo(() => parseYamlDocuments(source), [source])
  if (parsed.error) return <p className="au-reader-invalid" role="status">YAML preview unavailable: {parsed.error.replace(/\.$/, '')}. The original source is shown below.</p>
  const notices = <>{parsed.notices?.map((notice, i) => <p className="au-props-notice" key={i}>{notice}</p>)}{parsed.documents.length === 1 && parsed.versions?.[0] === '1.1' && <p className="au-props-notice">YAML 1.1 values, as declared by this document.</p>}</>
  if (parsed.documents.length === 1) {
    const value = parsed.documents[0]
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof TaggedYamlValue)) {
      return <>{notices}<Frontmatter data={value as Record<string, unknown>} host={host} path={path} renderText={renderText} renderType={renderType} format="yaml" /></>
    }
  }
  return <>{notices}<section className="au-yaml-values" aria-label="YAML values">{parsed.documents.map((value, i) => <section key={i}>
    {parsed.documents.length > 1 && <h2>Document {i + 1} · YAML {parsed.versions?.[i]}</h2>}
    <PropertyValue value={value} renderText={renderText} />
  </section>)}</section></>
}
