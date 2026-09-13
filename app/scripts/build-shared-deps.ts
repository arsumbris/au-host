// Builds the host's shared-dep bundle: one servable ESM instance per shared dependency, emitted to
// `app/shared-deps/dist/`. Every renderer bundle (projections + the shell) externals these and resolves
// them at runtime through a generated import map, so the whole app shares ONE React and ONE SDK instance.
//
// Two tools, each for its job:
//   - React is CJS (NODE_ENV-gated). rollup + @rollup/plugin-commonjs `esmExternals` carves each entry to
//     ESM with REAL NAMED EXPORTS (via a shim built from the runtime export names) and converts an external
//     CJS `require('react')` into a real ESM `import` (rolldown/esbuild instead emit a browser-breaking
//     `require()`). Each React subpath is its own served file with its siblings EXTERNAL, so the served graph
//     resolves through the one map and never inlines a second reconciler copy.
//   - au-host-sdk is ESM TypeScript. Its `.` entry has no runtime externals (its au-engine-sdk import is
//     type-only), so esbuild transpiles+bundles it directly. Its `/engine-reads` subpath DOES external
//     au-engine-sdk's renderer subpaths (a thin `export *` re-export), so that served file resolves them
//     through the map to the one served engine-sdk instance instead of inlining engine code.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { rollup } from 'rollup'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import * as esbuild from 'esbuild'

import { SHARED_DEP_SPECIFIERS } from '@arsumbris/au-host-sdk/shared-deps'

import { SHARED_DEPS, type SharedDep } from './shared-deps-manifest.ts'
import { writeDependencyNotices } from './dependency-notices.ts'

const require = createRequire(import.meta.url)
const APP = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = path.join(APP, 'shared-deps', 'dist')
const SHIMS = path.join(APP, 'shared-deps', '.shims')
const ID = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const isExternal = (external: string[]) => (id: string) =>
  external.some((e) => id === e || id.startsWith(e.replace(/\/\*$/, '') + '/'))

// A CJS dep (React): rollup + commonjs esmExternals, with a named-export shim. A CJS entry otherwise
// bundles to a useless default-only export that native-ESM `import { useState }` cannot consume, and an
// external CJS `require` stays a browser-breaking `require()` unless esmExternals converts it to `import`.
async function buildReactCjs(d: SharedDep) {
  const entry = require.resolve(d.spec)
  const names = Object.keys(require(d.spec)).filter((n) => ID.test(n) && n !== 'default' && n !== '__esModule')
  const shimPath = path.join(SHIMS, d.file)
  writeFileSync(shimPath, `import __d from ${JSON.stringify(entry)}\nexport default __d\nexport const { ${names.join(', ')} } = __d\n`)
  const bundle = await rollup({
    input: shimPath,
    external: isExternal(d.external),
    plugins: [
      replace({ preventAssignment: true, values: { 'process.env.NODE_ENV': JSON.stringify('production') } }),
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs({ esmExternals: true, requireReturnsDefault: 'auto' }),
    ],
    onwarn() {},
  })
  await bundle.write({ file: path.join(DIST, d.file), format: 'es' })
  await bundle.close()
  return names.length
}

// An ESM TypeScript dep (the SDKs, container-core, component-contract): esbuild, with ALL OTHER shared
// specifiers external so an import of a shared sibling resolves through the one map instead of inlining a
// second copy. Non-shared deps (zustand, type-query) stay bundled. Externalizing a shared spec this dep
// does NOT import is harmless (nothing to externalize).
async function buildTsEsm(d: SharedDep) {
  const external = SHARED_DEP_SPECIFIERS.filter((s) => s !== d.spec)
  const common = {
    outfile: path.join(DIST, d.file),
    bundle: true,
    format: 'esm' as const,
    platform: 'browser' as const,
    define: { 'process.env.NODE_ENV': '"production"' },
    external,
    logLevel: 'silent' as const,
  }
  if (d.esmReexport) {
    // Re-export entry: esbuild resolves `d.spec` via its `import` condition (the package's ESM build),
    // where `require.resolve` would hand back the CJS entry. `export *` carries the named exports.
    await esbuild.build({
      ...common,
      stdin: { contents: `export * from ${JSON.stringify(d.spec)}`, resolveDir: APP, loader: 'js' },
    })
  } else {
    await esbuild.build({ ...common, entryPoints: [require.resolve(d.spec)] })
  }
  return null
}

// A code-SPLIT group of subpaths from ONE package (au-engine-sdk): esbuild with several entryPoints and
// `splitting`, so the shared internal modules (reads/wire/read-helpers) are emitted as CHUNKS once and each
// subpath entry imports them by a relative path — resolved by the au-shared:// scheme from the entry's own
// versioned URL, so no map entry is needed for a chunk. All OTHER shared specifiers stay external. The entry
// output names come from the manifest `file` (via the entryPoints object keys), so the import map's entries
// resolve; chunks are relative and self-resolve.
async function buildTsEsmSplit(group: SharedDep[]) {
  const specs = new Set(group.map((d) => d.spec))
  const external = SHARED_DEP_SPECIFIERS.filter((s) => !specs.has(s))
  const entryPoints: Record<string, string> = {}
  for (const d of group) entryPoints[d.file.replace(/\.js$/, '')] = require.resolve(d.spec)
  await esbuild.build({
    entryPoints,
    outdir: DIST,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    external,
    entryNames: '[name]',
    chunkNames: 'chunk-[hash]',
    logLevel: 'silent',
  })
}

// ---- run ----
rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })
mkdirSync(SHIMS, { recursive: true })

const results = []
const splitGroups = new Map<string, SharedDep[]>()
for (const d of SHARED_DEPS) {
  if (d.kind === 'ts-esm-split') {
    const g = d.group ?? d.spec
    splitGroups.set(g, [...(splitGroups.get(g) ?? []), d])
    continue
  }
  const names = d.kind === 'react-cjs' ? await buildReactCjs(d) : await buildTsEsm(d)
  results.push({ file: d.file, names })
}
for (const group of splitGroups.values()) {
  await buildTsEsmSplit(group)
  for (const d of group) results.push({ file: d.file, names: null })
}
rmSync(SHIMS, { recursive: true, force: true })
writeDependencyNotices(path.resolve(APP, '..'), DIST)

console.log('shared-deps built ->', path.relative(APP, DIST))
for (const r of results) {
  const kb = (readFileSync(path.join(DIST, r.file)).length / 1024).toFixed(1)
  console.log(`  ${r.file.padEnd(26)} ${kb.padStart(7)} kB${r.names != null ? `  (${r.names} named exports)` : ''}`)
}
