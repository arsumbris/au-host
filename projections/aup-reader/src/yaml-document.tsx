import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MountHost } from '@arsumbris/au-host-sdk'
import { readResolveMember, readTypes, readTypeClosure, subscribeChanges, type WireTypeDef, type WireTypeClosureEntry, type WireShape, type WireBodyItem } from '@arsumbris/au-host-sdk/engine-reads'
import { parseYamlDocuments } from './yaml-documents'
import { YamlPreview } from './yaml-preview'
import { CodeBlock } from './code-block'
import { PropertyValue } from './frontmatter'

interface Definition { type: WireTypeDef; closure?: WireTypeClosureEntry }

function shapeLabel(shape: WireShape): string {
  switch (shape.kind) {
    case 'primitive': return shape.name
    case 'record': return shape.name
    case 'reference': return `${shape.name}*`
    case 'inline-or-reference': return `${shape.name}&`
    case 'enum': return `[${shape.members.join(', ')}]`
    case 'list': return `${shapeLabel(shape.inner)}[${shape.max !== undefined ? `${shape.min}..${shape.max}` : shape.min === 0 ? '' : shape.min === 1 ? '+' : `${shape.min}..`}]`
    case 'tuple': return `(${shape.elements.map(shapeLabel).join(', ')})`
    case 'union': case 'intersection': return `<${shape.branches.map(shapeLabel).join(shape.kind === 'union' ? ' | ' : ' & ')}>`
    case 'pinned': return `${shapeLabel(shape.inner)}@`
    case 'def-reference': return shape.bound ? `type<${shape.bound.kind === 'single' ? shape.bound.name : shape.bound.branches.join(shape.bound.op === 'union' ? ' | ' : ' & ')}>*` : 'type*'
    case 'compound-reference': return `<${shape.branches.join(shape.op === 'union' ? ' | ' : ' & ')}>${shape.mode === 'ref' ? '*' : '&'}`
    case 'refined': {
      const r = shape.refinement
      const constraints = [r.lower && `${r.lower.inclusive ? '>=' : '>'} ${r.lower.value}`, r.upper && `${r.upper.inclusive ? '<=' : '<'} ${r.upper.value}`, r.integer && 'integer', r.pattern !== undefined && `pattern ${r.pattern}`].filter(Boolean)
      return `${shape.base}{${constraints.join(', ')}}`
    }
    default: return 'any'
  }
}

function shapeReferences(shape: WireShape | null): string[] {
  if (!shape) return []
  switch (shape.kind) {
    case 'record': case 'reference': case 'inline-or-reference': return [shape.name]
    case 'list': case 'pinned': return shapeReferences(shape.inner)
    case 'tuple': return shape.elements.flatMap(shapeReferences)
    case 'union': case 'intersection': return shape.branches.flatMap(shapeReferences)
    case 'compound-reference': return shape.branches
    case 'def-reference': return shape.bound?.kind === 'single' ? [shape.bound.name] : shape.bound?.branches ?? []
    default: return []
  }
}

function BodyTemplate({ items, renderText, renderType }: { items: WireBodyItem[]; renderText: (text: string) => ReactNode; renderType: (claim: string) => ReactNode }): ReactNode {
  return <ul className="au-definition-body">{items.map((item, index) => <li key={index}>{item.kind === 'use' ? <>Includes {renderType(item.target)}</> : item.kind === 'fills' ? <>Fills {item.contract.fields.join(', ')}{item.contract.exclusive && ' · exclusive'}</> : <><strong>{item.name}</strong> <span className="au-props-source">{item.optional ? 'Optional section' : 'Required section'}</span>{item.guidance && <p>{renderText(item.guidance)}</p>}{item.fills && <p>Fills {item.fills.fields.join(', ')}{item.fills.exclusive && ' · exclusive'}</p>}{item.body && <BodyTemplate items={item.body} renderText={renderText} renderType={renderType} />}</>}</li>)}</ul>
}

function DefinitionView({ definition, renderText, renderType }: {
  definition: Definition; renderText: (text: string) => ReactNode; renderType: (claim: string) => ReactNode
}): ReactNode {
  const { type, closure } = definition
  const [inherited, setInherited] = useState(false)
  const own = new Set(type.fields.map(field => field.name))
  const inheritedFields = closure?.fields.filter(field => !own.has(field.name)) ?? []
  const fields = inherited ? [...type.fields, ...inheritedFields] : type.fields
  const qualify = (name: string) => name.includes('::') ? name : `${name}::${type.repo}`
  return <section className="au-definition" aria-label={`Type definition ${type.name}`}>
    <header className="au-definition-heading">
      <p className="au-definition-kind">{type.brand ? 'Value type' : type.sealed ? 'Sealed type' : type.abstract ? 'Abstract type' : 'Type definition'} · {type.repo}</p>
      <h1>{type.name}</h1>
      {type.doc && <p>{renderText(type.doc)}</p>}
      {type.parents.length > 0 && !closure && <p className="au-props-notice">Inherited field information is unavailable.</p>}
      {type.parents.length > 0 && <div className="au-definition-links"><span>Extends</span>{type.parents.map(parent => <span key={parent}>{renderType(qualify(parent))}</span>)}</div>}
    </header>
    {type.brand && <section aria-label="Value shape"><h2>Value shape</h2><code>{shapeLabel(type.brand.shape)}</code>{type.brand.member_docs && <PropertyValue value={type.brand.member_docs} renderText={renderText} />}</section>}
    {!type.brand && <>
      <div className="au-definition-section"><h2>Fields <span>{fields.length}</span></h2>{inheritedFields.length > 0 && <button className="au-props-detail-toggle" aria-pressed={inherited} onClick={() => setInherited(!inherited)}>{inherited ? 'Hide inherited fields' : `Show ${inheritedFields.length} inherited fields`}</button>}</div>
      {fields.length ? <dl className="au-definition-fields">{fields.map(field => {
        const origin = 'origin' in field ? field.origin as { name: string; repo: string } : null
        return <div className="au-definition-field" key={field.name}>
          <dt><code>{field.name}</code><span className="au-definition-required">{field.required ? 'Required' : 'Optional'}</span></dt>
          <dd><code className="au-definition-shape">{field.shape}</code>{field.doc && <p>{renderText(field.doc)}</p>}
            {[...new Set(shapeReferences(field.shape_ast))].length > 0 && <div className="au-definition-links" aria-label={`Related types for ${field.name}`}>{[...new Set(shapeReferences(field.shape_ast))].map(name => <span key={name}>{renderType(name.includes('::') ? name : `${name}::${origin?.repo ?? type.repo}`)}</span>)}</div>}
            {origin && <p className="au-props-origin">Declared by {renderType(`${origin.name}::${origin.repo}`)}</p>}
          </dd>
        </div>
      })}</dl> : <p className="au-props-notice">This type declares no fields.</p>}
    </>}
    {type.sealed && <section><h2>Branches</h2><div className="au-definition-links">{type.sealed.map(name => <span key={name}>{renderType(qualify(name))}</span>)}</div></section>}
    {!!type.meta_blocks?.length && <details className="au-definition-details"><summary>Metadata · {type.meta_blocks.length}</summary>{type.meta_blocks.map((block, index) => <section key={index}><h3>{renderType(qualify(block.type_name))}</h3><PropertyValue value={Object.fromEntries(block.body.map(field => [field.name, field.value]))} renderText={renderText} /></section>)}</details>}
    {type.effective_body && <details className="au-definition-details"><summary>Body template</summary><BodyTemplate items={type.effective_body} renderText={renderText} renderType={claim => renderType(qualify(claim))} /></details>}
    {type.required_meta.length > 0 && <details className="au-definition-details"><summary>Required metadata</summary>{type.required_meta.map(name => <p key={name}>{renderType(qualify(name))}</p>)}</details>}
  </section>
}

/** Engine source identities choose the definition view; untyped YAML retains its source-based fallback. */
export function YamlDocument({ source, host, path, renderText, renderType }: {
  source: string; host: MountHost; path: string | null
  renderText: (text: string) => ReactNode; renderType: (claim: string) => ReactNode
}): ReactNode {
  const invalid = useMemo(() => !!parseYamlDocuments(source).error, [source])
  const [definitions, setDefinitions] = useState<Definition[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let live = true, request = 0
    setDefinitions(null)
    const refresh = async () => {
      const ticket = ++request
      try {
        if (!path) { if (live) setDefinitions([]); return }
        const owner = await readResolveMember(host.engine, path)
        const repo = 'ready' in owner && owner.ready ? owner.result?.repo : undefined
        const types = await readTypes(host.engine, repo ? { repo } : undefined)
        if (!('ready' in types) || !types.ready) throw new Error('Type information unavailable')
        const matching = (types.result ?? []).filter(type => type.source.file === path)
        const next = await Promise.all(matching.map(async type => {
          const closure = await readTypeClosure(host.engine, type.name, type.repo)
          return { type, closure: 'ready' in closure && closure.ready && closure.result.length === 1 ? closure.result[0] : undefined }
        }))
        if (live && ticket === request) { setDefinitions(next); setUnavailable(false) }
      } catch { if (live && ticket === request) { setDefinitions([]); setUnavailable(true) } }
    }
    void refresh()
    const off = subscribeChanges(host.engine, () => void refresh())
    return () => { live = false; off() }
  }, [host, path, source])
  return <div className="au-yaml-document">
    {definitions === null ? <p role="status" className="au-props-notice">Reading document structure…</p> : !invalid && definitions.length ? definitions.map(definition => <DefinitionView key={`${definition.type.repo}:${definition.type.name}`} definition={definition} renderText={renderText} renderType={renderType} />) : <><YamlPreview source={source} host={host} path={path} renderText={renderText} renderType={renderType} />{unavailable && <p className="au-props-notice">Type information unavailable. Showing authored values.</p>}</>}
    <details className="au-yaml-source" open><summary>YAML source</summary><CodeBlock code={source} language="yaml" numbered host={host} path={path} /></details>
  </div>
}
