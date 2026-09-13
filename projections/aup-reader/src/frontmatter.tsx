import { TaggedYamlValue } from './yaml-documents'
import { contributionValue, TupleValue, BrandedValue } from './contribution-value'
export { contributionValue } from './contribution-value'
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { MountHost } from '@arsumbris/au-host-sdk'
import {
  readInstance, readType, readResolveTarget, readResolveMember, readTypeClosure, subscribeChanges,
  type WireInstance, type WireTypeClosureEntry, type WireClosureField,
} from '@arsumbris/au-host-sdk/engine-reads'

interface TypeInfo { claim: string; closure: WireTypeClosureEntry | null; fields?: WireClosureField[] }
interface Inspection { instance: WireInstance | null; types: TypeInfo[]; unavailable?: string }

function claimTarget(claim: string): string {
  return claim.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim()
}

async function inspect(host: MountHost, path: string): Promise<Inspection> {
  const read = await readInstance(host.engine, path)
  if (!('ready' in read) || !read.ready) return { instance: null, types: [], unavailable: 'Type information is unavailable.' }
  const instance = read.result
  if (!instance) return { instance: null, types: [] }
  const types = await Promise.all(instance.claim.map(async (claim): Promise<TypeInfo> => {
    if (!instance.resolved) return { claim, closure: null }
    const target = claimTarget(claim)
    const resolved = await readResolveTarget(host.engine, target, path)
    if (!('ready' in resolved) || !resolved.ready || resolved.result?.kind !== 'type-def') return { claim, closure: null }
    const owner = await readResolveMember(host.engine, resolved.result.path)
    if (!('ready' in owner) || !owner.ready || !owner.result) return { claim, closure: null }
    const closure = await readTypeClosure(host.engine, target.split('::')[0]!, owner.result.repo)
    const entry = 'ready' in closure && closure.ready && closure.result.length === 1 ? closure.result[0]! : null
    const declarations = await Promise.all((entry?.ancestors ?? []).map(async origin => {
      const type = await readType(host.engine, `${origin.name}::${origin.repo}`)
      return 'ready' in type && type.ready && type.result ? type.result.fields.map(field => ({ ...field, origin })) : []
    }))
    return { claim, closure: entry, fields: declarations.flat() }
  }))
  return { instance, types }
}

function Chevron({ open }: { open: boolean }): ReactNode {
  return <svg className="au-props-chevron" data-open={open} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m4.5 3 3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function Reveal({ open, id, children }: { open: boolean; id?: string; children: ReactNode }): ReactNode {
  const [visited, setVisited] = useState(open)
  useEffect(() => { if (open) setVisited(true) }, [open])
  return <div id={id} className="au-props-reveal" data-open={open} inert={!open} aria-hidden={!open}><div>{(open || visited) && children}</div></div>
}

function Disclosure({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className={className}><button className="au-props-detail-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Chevron open={open} />{label}</button><Reveal open={open} id={id}>{children}</Reveal></div>
}

function FieldRow({ name, value, children }: { name: string; value: ReactNode; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="au-props-row"><dt><button className="au-props-field-toggle" aria-expanded={open} aria-controls={id} aria-label={`Inspect ${name}`} title={`Inspect ${name}: type, documentation and origin`} onClick={() => setOpen(!open)}><span>{name}</span><Chevron open={open} /></button></dt><dd>{value}</dd><dd className="au-props-field-detail"><Reveal open={open} id={id}><div className="au-props-inspect">{children}</div></Reveal></dd></div>
}

const PROPERTY_BATCH = 50

function PropertyList({ value, renderText, depth, ancestors }: {
  value: unknown[]; renderText: (text: string) => ReactNode; depth: number; ancestors: readonly unknown[]
}): ReactNode {
  const [visible, setVisible] = useState(PROPERTY_BATCH)
  return <><ul className="au-props-list" data-structured={value.some(item => item !== null && typeof item === 'object')}>{value.slice(0, visible).map((item, i) => <li key={i}><PropertyValue value={item} renderText={renderText} depth={depth + 1} ancestors={[...ancestors, value]} /></li>)}</ul>
    {visible < value.length && <button className="au-props-toggle" onClick={() => setVisible(visible + PROPERTY_BATCH)}>Show {Math.min(PROPERTY_BATCH, value.length - visible)} more items ({visible} of {value.length} shown)</button>}</>
}

function PropertyEntries({ value, renderText, depth, ancestors }: {
  value: object; renderText: (text: string) => ReactNode; depth: number; ancestors: readonly unknown[]
}): ReactNode {
  const [visible, setVisible] = useState(PROPERTY_BATCH)
  const entries = Object.entries(value)
  return <><dl>{entries.slice(0, visible).map(([key, item]) => <div key={key}><dt>{key}</dt><dd><PropertyValue value={item} renderText={renderText} depth={depth + 1} ancestors={[...ancestors, value]} /></dd></div>)}</dl>
    {visible < entries.length && <button className="au-props-toggle" onClick={() => setVisible(visible + PROPERTY_BATCH)}>Show {Math.min(PROPERTY_BATCH, entries.length - visible)} more properties ({visible} of {entries.length} shown)</button>}</>
}

function MappingValue({ value, renderText, depth, ancestors }: {
  value: Map<unknown, unknown>; renderText: (text: string) => ReactNode; depth: number; ancestors: readonly unknown[]
}): ReactNode {
  const [visible, setVisible] = useState(PROPERTY_BATCH)
  return <Disclosure className="au-props-object" label={<>{value.size} entries</>}><dl>{[...value].slice(0, visible).map(([key, item], i) => <div key={i}>
    <dt><PropertyValue value={key} renderText={renderText} depth={depth + 1} ancestors={[...ancestors, value]} /></dt>
    <dd><PropertyValue value={item} renderText={renderText} depth={depth + 1} ancestors={[...ancestors, value]} /></dd>
  </div>)}</dl>{visible < value.size && <button className="au-props-toggle" onClick={() => setVisible(visible + PROPERTY_BATCH)}>Show {Math.min(PROPERTY_BATCH, value.size - visible)} more entries ({visible} of {value.size} shown)</button>}</Disclosure>
}

export function PropertyValue({ value, renderText, depth = 0, ancestors = [] }: {
  value: unknown; renderText: (text: string) => ReactNode; depth?: number; ancestors?: readonly unknown[]
}): ReactNode {
  if (value instanceof TupleValue) return <span className="au-props-tuple">{value.brand}{'('}{value.items.map((item, index) => <span key={index}>{index > 0 && ', '}<PropertyValue value={item} renderText={renderText} depth={depth + 1} ancestors={ancestors} /></span>)}{')'}</span>
  if (value instanceof BrandedValue) return <span>{value.brand}{'('}<PropertyValue value={value.value} renderText={renderText} depth={depth + 1} ancestors={ancestors} />{')'}</span>
  if (value === undefined) return <span className="au-props-empty">Not provided</span>
  if (value === null) return <span className="au-props-empty">Not set</span>
  if (value === '') return <span className="au-props-empty">Empty text</span>
  if (typeof value === 'boolean') return <span className="au-props-scalar">{String(value)}</span>
  if (typeof value === 'number' || typeof value === 'bigint') return <span className="au-props-number">{String(value)}</span>
  if (typeof value === 'string') {
    const ambiguous = /^(true|false|null|~)$/i.test(value) || (value.trim() !== '' && !Number.isNaN(Number(value)))
    return <span className="au-props-text">{ambiguous ? JSON.stringify(value) : renderText(value)}</span>
  }
  if (ancestors.includes(value)) return <span className="au-props-empty">Alias to an enclosing value</span>
  if (value instanceof TaggedYamlValue) return <div className="au-yaml-tagged"><span className="au-props-source">{value.tag}</span><PropertyValue value={value.value} renderText={renderText} depth={depth + 1} ancestors={[...ancestors, value]} /></div>
  if (value instanceof Map) return <MappingValue value={value} renderText={renderText} depth={depth} ancestors={ancestors} />
  if (depth >= 8) {
    const seen = new WeakSet<object>()
    return <pre className="au-props-raw">{JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') { if (seen.has(item)) return '[Alias]'; seen.add(item) }
      return typeof item === 'bigint' ? String(item) : item
    }, 2)}</pre>
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="au-props-empty">Empty list</span>
    const list = <PropertyList value={value} renderText={renderText} depth={depth} ancestors={ancestors} />
    return value.length > PROPERTY_BATCH ? <Disclosure className="au-props-object" label={<>{value.length} items</>}>{list}</Disclosure> : list
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return <span className="au-props-empty">Empty object</span>
    return <Disclosure className="au-props-object" label={<>{entries.length} properties</>}><PropertyEntries value={value} renderText={renderText} depth={depth} ancestors={ancestors} /></Disclosure>
  }
  return <span>{String(value)}</span>
}

export function Frontmatter({ data, host, path, renderText, renderType, format = 'markdown' }: {
  data: Record<string, unknown>; host: MountHost; path: string | null
  renderText: (text: string) => ReactNode; renderType: (claim: string) => ReactNode; format?: 'markdown' | 'yaml'
}): ReactNode {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [showAbsent, setShowAbsent] = useState(false)
  const [visible, setVisible] = useState(PROPERTY_BATCH)
  const [expanded, setExpanded] = useState(() => (host.viewStore?.get('reader.properties.expanded') as boolean | undefined) ?? false)
  const panelId = useId()
  const toggleProperties = (): void => {
    const next = !expanded
    setExpanded(next)
    host.viewStore?.set(next, 'reader.properties.expanded')
  }
  useEffect(() => {
    setInspection(null)
    setShowAbsent(false)
    if (!path) return
    let live = true
    let request = 0
    const refresh = async (): Promise<void> => {
      const current = ++request
      try {
        const next = await inspect(host, path)
        if (live && current === request) setInspection(next)
      } catch {
        if (live && current === request) setInspection({ instance: null, types: [], unavailable: 'Type information is unavailable.' })
      }
    }
    void refresh()
    const off = subscribeChanges(host.engine, () => void refresh())
    return () => { live = false; off() }
  }, [host, path, data])

  const instance = inspection?.instance
  const definitions = [...new Map((inspection?.types.flatMap(t => t.fields ?? t.closure?.fields ?? []) ?? []).map(field => [`${field.origin.repo}:${field.origin.name}:${field.name}`, field])).values()]
  const typeIdentity = typeof data.type === 'string' || (Array.isArray(data.type) && data.type.every(item => typeof item === 'string'))
  const isProperty = (key: string) => format === 'yaml' ? key !== 'type' || !typeIdentity : key !== 'type' && key !== '^'
  const authored = Object.keys(data).filter(isProperty)
  const effective = new Map(instance?.effective_values.map(f => [f.field, f]) ?? [])
  const authoredNames = new Set(authored.map(key => key.replace(/\{[^{}]+\}$/, '')))
  const absent = [...new Set(definitions.map(f => f.name))].filter(key => !authoredNames.has(key) && !effective.has(key))
  const keys = [...new Set([...authored, ...effective.keys()].filter(isProperty))]
  const missingRequired = absent.filter(key => definitions.some(f => f.name === key && f.required))
  keys.push(...(showAbsent ? absent : missingRequired))
  const claims = instance?.claim ?? (typeIdentity ? (Array.isArray(data.type) ? data.type.map(String) : [String(data.type)]) : [])
  const issues = instance?.diagnostics ?? []

  return <section className="au-props" aria-label="Document properties">
    <div className="au-props-identity">
      <button className="au-props-disclosure" aria-expanded={expanded} aria-controls={panelId} onClick={toggleProperties}>
        <Chevron open={expanded} />
        Properties <span className="au-props-count">{authored.length}</span>
      </button>
      {!expanded && <span className="au-props-compact-types">{claims.map(claim => <span key={claim}>{renderType(claim)}</span>)}</span>}
      {(!inspection || inspection.unavailable || (claims.length > 0 && !instance?.resolved)) && <span className="au-props-state">{!inspection ? 'Reading types…' : inspection.unavailable ? 'Unavailable' : 'Unresolved type'}</span>}
    </div>
    {issues.length > 0 && <details className="au-props-issues"><summary>{issues.filter(d => d.severity === 'error').length > 0 ? `${issues.filter(d => d.severity === 'error').length} errors` : `${issues.length} notices`}</summary><ul>{issues.map((d, i) => <li key={i}><strong>{d.severity}</strong> {d.message}</li>)}</ul></details>}
    <Reveal open={expanded} id={panelId}><div className="au-props-panel">
    {claims.length > 0 && <div className="au-props-types">{claims.map(claim => {
      const entry = inspection?.types.find(t => t.claim === claim)?.closure
      return <div className="au-props-type" key={claim}><span className="au-props-type-label">Type</span><span className="au-props-type-name">{renderType(claim)}</span><Disclosure className="au-props-type-disclosure" label={<span>Type details<span className="au-props-sr-only"> for {claimTarget(claim)}</span></span>}>
        <div className="au-props-inspect">
          {entry ? <><div className="au-props-definition-heading"><strong>{entry.fields.length} fields</strong><span>Defined in {entry.identity.repo}</span></div><p>{entry.ancestors.length > 1 ? 'Extends ' : 'Type identity: '}{entry.ancestors.filter(a => entry.ancestors.length === 1 || a.name !== entry.identity.name || a.repo !== entry.identity.repo).map(a => `${a.name}::${a.repo}`).join(', ')}</p><dl>{entry.fields.map(f => <div key={f.name}><dt>{f.name}</dt><dd><div className="au-props-definition-heading"><strong>{f.shape}</strong><span>{f.required ? 'Required' : 'Optional'}</span></div>{f.doc && <p className="au-props-field-doc">{f.doc}</p>}</dd></div>)}</dl></> : <p>{inspection ? 'This document has no resolved definition for this claim.' : 'Reading definition…'}</p>}
        </div>
      </Disclosure></div>
    })}</div>}
    {inspection?.unavailable && <p className="au-props-notice">{inspection.unavailable} Authored values remain available.</p>}
    <dl className="au-props-grid">{keys.slice(0, visible).map(key => {
      const qualified = /^(.+)\{([^{}]+)\}$/.exec(key)
      const name = qualified?.[1] ?? key
      const declarations = definitions.filter(f => f.name === name)
      const fields = declarations.filter(field => !qualified || qualified[2] === field.origin.name || qualified[2] === `${field.origin.name}::${field.origin.repo}`)
      const values = effective.get(key)?.containers
      const body = values?.some(v => v.contributions.some(c => c.surface !== 'frontmatter'))
      const list = Array.isArray(data[key]) || fields.some(f => f.shape_ast?.kind === 'list')
      const value = (format === 'yaml' && Object.hasOwn(data, key)) || typeof data[key] === 'bigint' || data[key] instanceof TaggedYamlValue || data[key] instanceof Map ? data[key] : values?.length ? values.length === 1 && !list ? contributionValue(values[0]!.value) : values.map(v => contributionValue(v.value)) : data[key]
      const valueSpans = values?.flatMap(container => container.contributions.map(contribution => contribution.location.byte_range)) ?? []
      const fieldIssues = issues.filter(issue => valueSpans.some(span => span && issue.span.range.start < span.end && issue.span.range.end > span.start))
      return <FieldRow name={key} key={key} value={<><PropertyValue value={value} renderText={renderText} />{missingRequired.includes(key) && <span className="au-props-source">Required value missing</span>}{body && <span className="au-props-source">From document body</span>}{fieldIssues.length > 0 && <ul className="au-props-field-issues">{fieldIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}</>}>
          {fields.length > 1 && <p>Declarations by origin</p>}
          {fields.length ? fields.map((f, i) => <div key={i}><div className="au-props-definition-heading"><strong>{f.shape}</strong><span>{f.required ? 'Required' : 'Optional'}</span></div>{f.doc && <p>{f.doc}</p>}<p className="au-props-origin">Declared by {renderText(`[[${f.origin.name}::${f.origin.repo}]]`)}</p></div>) : <p>{instance?.resolved ? 'Additional property; not declared by the resolved type.' : 'No resolved field definition.'}</p>}
          {values && <p className="au-props-origin">Value from {[...new Set(values.flatMap(v => v.contributions.map(c => c.surface === 'frontmatter' ? (format === 'yaml' ? 'YAML' : 'frontmatter') : c.surface.replaceAll('_', ' '))))].join(', ')}</p>}
      </FieldRow>
    })}</dl>
    {visible < keys.length && <button className="au-props-toggle" onClick={() => setVisible(visible + PROPERTY_BATCH)}>Show {Math.min(PROPERTY_BATCH, keys.length - visible)} more properties ({visible} of {keys.length} shown)</button>}
    {absent.length > missingRequired.length && <button className="au-props-toggle" onClick={() => setShowAbsent(!showAbsent)}>{showAbsent ? 'Hide unfilled optional properties' : `Show ${absent.length - missingRequired.length} unfilled optional ${absent.length - missingRequired.length === 1 ? 'property' : 'properties'}`}</button>}
    </div></Reveal>
  </section>
}
