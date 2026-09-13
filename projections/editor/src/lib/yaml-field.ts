import { yamlLanguage } from '@codemirror/lang-yaml'
import type { SyntaxNode, Tree } from '@lezer/common'
import { readResolveMember, readType, readTypeClosure, type WireReader, type WireClosureField, type WireShape } from '@arsumbris/au-host-sdk/engine-reads'

export interface YamlFieldContext {
  from: number
  to: number
  steps: { field: string; claims: string[]; origin?: string }[]
}

function scalar(source: string, node: SyntaxNode | null): string | null {
  if (!node || !['Literal', 'QuotedLiteral', 'Key'].includes(node.name)) return null
  const text = source.slice(node.from, node.to)
  if (text.startsWith('"')) { try { return JSON.parse(text) } catch { return null } }
  if (text.startsWith("'")) return text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : null
  return text
}

function claimsIn(source: string, mapping: SyntaxNode | null): string[] {
  if (!mapping) return []
  const pair = mapping.getChildren('Pair').find(pair => scalar(source, pair.getChild('Key')) === 'type')
  const value = pair?.getChild(':')?.nextSibling ?? null
  if (!value) return []
  const result: string[] = []
  function collect(node: SyntaxNode): void {
    const text = scalar(source, node)
    if (text !== null) { result.push(text.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim()); return }
    for (let child = node.firstChild; child; child = child.nextSibling) collect(child)
  }
  collect(value)
  return result
}

let cachedSource: string | undefined
let cachedTree: Tree | undefined

/** Syntax comes from the current buffer; declaration semantics come from the engine below. */
export function yamlFieldContext(source: string, pos: number): YamlFieldContext | null {
  if (cachedSource !== source || !cachedTree) { cachedSource = source; cachedTree = yamlLanguage.parser.parse(source) }
  const tree = cachedTree
  let key: SyntaxNode | null = tree.resolveInner(pos, -1)
  while (key && key.name !== 'Key') key = key.parent
  if (!key || pos < key.from || pos > key.to) return null
  const field = scalar(source, key)
  if (!field || field === 'type') return null
  const steps: YamlFieldContext['steps'] = []
  for (let node: SyntaxNode | null = key.parent; node; node = node.parent) {
    if (node.name !== 'Pair') continue
    const name = scalar(source, node.getChild('Key'))
    if (!name) return null
    const qualified = /^(.+)\{([^{}]+)\}$/.exec(name)
    steps.unshift({ field: qualified?.[1] ?? name, claims: claimsIn(source, node.parent), ...(qualified ? { origin: qualified[2] } : {}) })
  }
  if (!steps.some(step => step.claims.length)) return null
  return { from: key.from, to: key.to, steps }
}

function inlineTypes(shape: WireShape | null): string[] {
  if (!shape) return []
  switch (shape.kind) {
    case 'record': case 'inline-or-reference': return [shape.name]
    case 'list': return inlineTypes(shape.inner)
    case 'union': case 'intersection': return shape.branches.flatMap(inlineTypes)
    default: return []
  }
}

/** Walk nested record shapes and explicit inline claims, preserving repo ownership at every step. */
export async function resolveYamlField(reader: WireReader, path: string, context: YamlFieldContext): Promise<WireClosureField[]> {
  const owner = await readResolveMember(reader, path)
  const repo = 'ready' in owner && owner.ready ? owner.result?.repo : undefined
  const qualify = (name: string, owner?: string) => name.includes('::') || !owner ? name : `${name}::${owner}`
  let claims: string[] = [], fields: WireClosureField[] = []
  for (const step of context.steps) {
    if (step.claims.length) claims = step.claims.map(name => qualify(name, repo))
    const closures = await Promise.all([...new Set(claims)].map(claim => readTypeClosure(reader, claim)))
    // The closure supplies ancestry, but its field row is only a canonical origin
    // for divergent fields. Read each declared shape so no valid origin is hidden.
    const identities = closures.flatMap(result => 'ready' in result && result.ready ? result.result.flatMap(entry => entry.ancestors) : [])
    const declarations = await Promise.all([...new Map(identities.map(identity => [`${identity.name}::${identity.repo}`, identity])).values()].map(async identity => {
      if (step.origin && step.origin !== identity.name && step.origin !== `${identity.name}::${identity.repo}`) return []
      const type = await readType(reader, `${identity.name}::${identity.repo}`)
      return 'ready' in type && type.ready && type.result ? type.result.fields.filter(field => field.name === step.field).map(field => ({ ...field, origin: identity })) : []
    }))
    fields = declarations.flat()
    fields = [...new Map(fields.map(field => [`${field.origin.repo}:${field.origin.name}:${field.name}`, field])).values()]
    claims = fields.flatMap(field => inlineTypes(field.shape_ast).map(name => qualify(name, field.origin.repo)))
  }
  return fields
}
