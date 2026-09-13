import { LineCounter, isAlias, isMap, isScalar, isSeq, parseAllDocuments, type Document, type Node } from 'yaml'

/** An explicit tag is authored information, including tags whose meaning belongs to an application. */
export class TaggedYamlValue {
  tag: string
  value: unknown
  constructor(tag: string) { this.tag = tag.replace('tag:yaml.org,2002:', '!!'); this.value = null }
}

function scalarValue(value: unknown): unknown {
  return typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
}

function displayDocument(doc: Document): unknown {
  // Let the parser enforce its alias-expansion limit before traversing the syntax graph.
  doc.toJS({ mapAsMap: true, maxAliasCount: 100 })
  const seen = new WeakMap<object, unknown>()
  function textKeys(node: Node | null, visited = new WeakSet<object>()): boolean {
    if (!node || visited.has(node)) return true
    visited.add(node)
    if (isAlias(node)) return textKeys(node.resolve(doc) ?? null, visited)
    if (isSeq(node)) return node.items.every(item => textKeys(item as Node | null, visited))
    return isMap(node) && node.items.every(pair => isScalar(pair.key) && typeof pair.key.value === 'symbol' && pair.key.value.description === '<<'
      ? textKeys(pair.value as Node | null, visited)
      : isScalar(pair.key) && typeof pair.key.value === 'string' && !pair.key.tag)
  }
  function convert(node: Node | null): unknown {
    if (!node) return null
    if (isAlias(node)) return convert(node.resolve(doc) ?? null)
    if (seen.has(node)) return seen.get(node)
    const tagged = node.tag ? new TaggedYamlValue(node.tag) : null
    let value: unknown
    if (isMap(node)) {
      const merges = node.items.filter(pair => isScalar(pair.key) && typeof pair.key.value === 'symbol' && pair.key.value.description === '<<')
      const authored = node.items.filter(pair => !merges.includes(pair))
      const stringKeys = textKeys(node)
      const mapping = stringKeys ? {} : new Map<unknown, unknown>()
      value = mapping
      seen.set(node, tagged ?? mapping)
      const put = (key: unknown, item: unknown, overwrite: boolean) => {
        if (mapping instanceof Map) { if (overwrite || !mapping.has(key)) mapping.set(key, item) }
        else if (overwrite || !Object.hasOwn(mapping, String(key))) Object.defineProperty(mapping, String(key), { value: item, enumerable: true, writable: true, configurable: true })
      }
      for (const pair of merges) {
        const merged = convert(pair.value as Node | null)
        for (const item of Array.isArray(merged) ? merged : [merged]) {
          const values = item instanceof TaggedYamlValue ? item.value : item
          for (const [key, value] of values instanceof Map ? values : Object.entries(values as object)) put(key, value, false)
        }
      }
      for (const pair of authored) put(convert(pair.key as Node | null), convert(pair.value as Node | null), true)

    } else if (isSeq(node)) {
      const items: unknown[] = []
      value = items
      seen.set(node, tagged ?? items)
      for (const item of node.items) items.push(convert(item as Node | null))
    } else if (isScalar(node)) {
      // Keep date spelling and custom scalar contents, without inventing application semantics.
      value = (node.value instanceof Date || node.value instanceof Uint8Array) ? node.source : scalarValue(node.value)
    }
    if (tagged) { tagged.value = value; value = tagged }
    seen.set(node, value)
    return value
  }
  return convert(doc.contents)
}

export function parseYamlDocuments(source: string): { documents: unknown[]; versions?: string[]; notices?: string[]; error?: string } {
  try {
    const lineCounter = new LineCounter()
    const parsed = parseAllDocuments(source, { version: '1.2', intAsBigInt: true, prettyErrors: false, lineCounter })
    const at = (issue: { message: string; pos: [number, number] }) => {
      const { line, col } = lineCounter.linePos(issue.pos[0])
      return `${issue.message} (line ${line}, column ${col})`
    }
    const issue = parsed.flatMap(doc => doc.errors)[0]
    if (issue) return { documents: [], error: at(issue) }
    return {
      documents: parsed.map(displayDocument),
      versions: parsed.map(doc => doc.directives?.yaml.version ?? '1.2'),
      notices: parsed.flatMap(doc => doc.warnings.filter(warning => warning.code !== 'TAG_RESOLVE_FAILED').map(at)),
    }
  } catch (error) {
    return { documents: [], error: error instanceof Error ? error.message : 'The YAML could not be read.' }
  }
}
