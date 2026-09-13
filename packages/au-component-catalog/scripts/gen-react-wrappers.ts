// component-layer React WRAPPER codegen CLI: discovers THIS catalog's ui-component tags from its
// type-defs and emits the `<AuXxx>` React wrapper module (src/react.ts, the `./react` sub-output).
// Filesystem-based — no daemon, no engine-sdk dep: a ui-component tag is a `type/<tag>.type.yaml`
// whose `extends:` base is `ui-component`. Props come from the def's `fields:`, events from the `meta`
// block's `events: [...]`. A third-party catalog runs the SAME framework tool over its own type/ dir.
//
//   node --experimental-transform-types scripts/gen-react-wrappers.ts --dir type --out src/react.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReactWrappers, type WrapperComponent } from './react-wrapper-builder.ts'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  return v && !v.startsWith('--') ? v : fallback
}

/** The base type a def extends, bare (strip `::repo` + quotes). Null when it has no single-line `extends:`. */
function parentBase(yaml: string): string | null {
  const m = yaml.match(/^extends:\s*(.+)$/m)
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '').split('::')[0].trim()
}

/** The `fields:` block's field NAMES (props). One level of indent; docstrings/comments/blank lines skipped. */
function parseFields(yaml: string): string[] {
  const out: string[] = []
  let inFields = false
  for (const line of yaml.split('\n')) {
    if (/^fields:\s*$/.test(line)) { inFields = true; continue }
    if (!inFields) continue
    if (/^\S/.test(line)) break // next top-level key ends the block
    const m = line.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*)\??:\s*\S/)
    if (m) out.push(m[1])
  }
  return out
}

/** The `meta` block's declared event names (`events: [au-toggle, …]`). Only the meta block carries one. */
function parseEvents(yaml: string): string[] {
  const m = yaml.match(/^\s+events:\s*\[([^\]]*)\]/m)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

const dir = arg('dir', 'type')
const out = arg('out', 'src/react.ts')

const components: WrapperComponent[] = []
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.type.yaml')) continue
  const yaml = readFileSync(join(dir, file), 'utf8')
  if (parentBase(yaml) !== 'ui-component') continue // records + non-components skipped
  const tag = file.slice(0, -'.type.yaml'.length)
  components.push({ tag, fields: parseFields(yaml), events: parseEvents(yaml) })
}

writeFileSync(out, buildReactWrappers(components))
console.log(`wrote ${out} — ${components.length} ui-component wrappers: ${components.map((c) => c.tag).sort().join(', ')}`)
