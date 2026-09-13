// component-layer JSX codegen CLI: discovers THIS catalog's ui-component tags from its type-defs and
// emits the React JSX augmentation (src/react.ts, the `./react` sub-output). Filesystem-based — no
// daemon, no engine-sdk dep: a ui-component tag is a `type/<tag>.type.yaml` whose `extends:` base is
// `ui-component` (the def name == the filename stem, per the engine's type-file convention). A
// third-party catalog runs the SAME framework tool over its own type/ dir. It is deliberately NOT
// au-type-codegen — that tool stays generic + framework-neutral; the react augmentation is
// React-specific AND ui-component-convention-specific, so it lives at the component layer.
//
//   node --experimental-transform-types scripts/gen-react-jsx.ts --dir type --out src/react-jsx.ts
//
// The `./react` sub-output is now the wrapper module (gen-react-wrappers.ts → src/react.ts); THIS emits
// the sibling JSX augmentation (src/react-jsx.ts) the wrapper module re-exports for residual intrinsic
// `<au-*>` usage + children typing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReactJsxAugmentation } from './react-jsx-builder.ts'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  return v && !v.startsWith('--') ? v : fallback
}

/** The base type a def extends, bare (strip `::repo` + quotes). Null when the def has no single-line
 *  `extends:` (a top-level record like `au-command-item`), which excludes it from the component tag set.
 *  A def declares its base with `extends:`; `type:` is the instance identity key, absent on a def. */
function parentBase(yaml: string): string | null {
  const m = yaml.match(/^extends:\s*(.+)$/m)
  if (!m) return null
  return m[1]
    .trim()
    .replace(/^["']|["']$/g, '')
    .split('::')[0]
    .trim()
}

const dir = arg('dir', 'type')
const out = arg('out', 'src/react-jsx.ts')

const tags: string[] = []
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.type.yaml')) continue
  const yaml = readFileSync(join(dir, file), 'utf8')
  if (parentBase(yaml) !== 'ui-component') continue // records + non-components skipped
  tags.push(file.slice(0, -'.type.yaml'.length))
}

writeFileSync(out, buildReactJsxAugmentation(tags))
console.log(`wrote ${out} — ${tags.length} ui-component tags: ${[...tags].sort().join(', ')}`)
