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

/** The type NAME a `.type.yaml` file declares — its basename stem minus the `.type` tail. The type
 *  system derives a def's identity from its filename, so this is authoritative, bundles included
 *  (`<bundle>/<member>.type.yaml` → `<member>`). Null for a non-type-def path. */
export function typeNameFromPath(path: string): string | null {
  const m = /(?:^|\/)([^/]+?)\.type\.ya?ml$/.exec(path)
  return m ? m[1]! : null
}

/** A field KEY declared directly under a type-def's top-level `fields:` map. Returns the field name +
 *  key span. A type-def DECLARES fields, it does not CLAIM a type, so `yamlFieldContext` (which needs a
 *  `type:` claim) returns null here; this is its type-def-file twin. */
export function typeDefFieldAt(source: string, pos: number): { field: string; from: number; to: number } | null {
  if (cachedSource !== source || !cachedTree) { cachedSource = source; cachedTree = yamlLanguage.parser.parse(source) }
  let key: SyntaxNode | null = cachedTree.resolveInner(pos, -1)
  while (key && key.name !== 'Key') key = key.parent
  if (!key || pos < key.from || pos > key.to) return null
  const raw = scalar(source, key)
  if (!raw) return null
  // Parent chain: Key → Pair → (block mapping) → Pair whose key is `fields`. So the key sits directly
  // inside the value map of a `fields:` declaration, not (say) a `meta:` sub-region.
  const fieldsPair = key.parent?.parent?.parent ?? null
  if (!fieldsPair || fieldsPair.name !== 'Pair' || scalar(source, fieldsPair.getChild('Key')) !== 'fields') return null
  // The optional marker `?` sits on the NAME side of a declaration (`myField?: shape`); it is not part of
  // the field's name. `?` is illegal in a type-def name, so a trailing one is always the marker. Strip it
  // so the name matches the engine's declared field.
  return { field: raw.replace(/\?$/, ''), from: key.from, to: key.to }
}

/** The qualified self-claim for a type-def file (`name::repo`), so its OWN field declarations resolve
 *  through the same closure read the instance path uses. */
export async function typeDefClaim(reader: WireReader, path: string): Promise<string | null> {
  const name = typeNameFromPath(path)
  if (!name) return null
  const owner = await readResolveMember(reader, path)
  const repo = 'ready' in owner && owner.ready ? owner.result?.repo : undefined
  return repo ? `${name}::${repo}` : name
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
      const type = await readType(reader, `${identity.name}::${identity.repo}`)
      return 'ready' in type && type.ready && type.result ? type.result.fields.filter(field => field.name === step.field).map(field => ({ ...field, origin: identity })) : []
    }))
    const declared = [...new Map(declarations.flat().map(field => [`${field.origin.repo}:${field.origin.name}:${field.name}`, field])).values()]
    // A field is divergent when its origins declare it with different shapes, whichever origin a qualifier
    // then picks; each origin keeps its own row.
    const divergent = new Set(declared.map(field => field.shape)).size > 1
    const picked = step.origin ? declared.filter(field => step.origin === field.origin.name || step.origin === `${field.origin.name}::${field.origin.repo}`) : declared
    fields = picked.map(field => ({ ...field, divergent }))
    claims = fields.flatMap(field => inlineTypes(field.shape_ast).map(name => qualify(name, field.origin.repo)))
  }
  return fields
}
