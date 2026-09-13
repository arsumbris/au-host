// The host's BUILD RECIPE for the shared deps: how each specifier in the CONTRACT
// (`@arsumbris/au-host-sdk/shared-deps`, the single source of the SET) is built to servable ESM and which
// file it maps to. The contract list is authored ONCE on au-host-sdk (so every bundle — shell, projections,
// component sets, out-of-tree authors — externalizes the same set); this file adds the app-owned build info,
// keyed by that list, so the two can never drift (a spec with no recipe fails the build loudly).
//
// `kind` dispatches the build tool:
//   - `react-cjs`: rollup + @rollup/plugin-commonjs esmExternals (React is CJS; converts external CJS
//     `require` to ESM `import`, synthesizes real named exports via a shim).
//   - `ts-esm`:    esbuild (an ESM TypeScript package; the builder externals all OTHER shared specifiers).
//   - `ts-esm-split`: esbuild code-SPLITTING over a `group` of subpaths from ONE package (au-engine-sdk),
//     so the shared internal modules (reads/wire) are emitted as chunks ONCE, not inlined per subpath.

import { SHARED_DEP_SPECIFIERS } from '@arsumbris/au-host-sdk/shared-deps'

export interface SharedDep {
  /** The bare specifier renderer bundles import (and the import map resolves). */
  spec: string
  /** The served file name under app/shared-deps/dist. */
  file: string
  /** Dispatches the build tool. */
  kind: 'react-cjs' | 'ts-esm' | 'ts-esm-split'
  /** For `react-cjs`: sibling specifiers kept external. `ts-esm` externals all other shared specs (computed). */
  external: string[]
  /** For `ts-esm-split`: the group key; all specs sharing it build in ONE splitting esbuild call. */
  group?: string
  /** For `ts-esm`: bundle via an esbuild ESM re-export entry (`export * from '<spec>'`) instead of
   *  `require.resolve(spec)`. Needed for a package whose `.` export resolves to CJS under `require`
   *  (e.g. three): the re-export lets esbuild pick the package's `import` condition → its ESM build. */
  esmReexport?: boolean
}

// Build info per shared specifier. `external` is meaningful only for `react-cjs` (its React siblings).
const RECIPE: Record<
  string,
  { file: string; kind: 'react-cjs' | 'ts-esm' | 'ts-esm-split'; external?: string[]; group?: string; esmReexport?: boolean }
> = {
  react: { file: 'react.js', kind: 'react-cjs', external: [] },
  'react/jsx-runtime': { file: 'react-jsx-runtime.js', kind: 'react-cjs', external: ['react'] },
  'react/jsx-dev-runtime': { file: 'react-jsx-dev-runtime.js', kind: 'react-cjs', external: ['react'] },
  'react-dom': { file: 'react-dom.js', kind: 'react-cjs', external: ['react'] },
  'react-dom/client': { file: 'react-dom-client.js', kind: 'react-cjs', external: ['react', 'react-dom'] },
  '@arsumbris/au-host-sdk': { file: 'au-host-sdk.js', kind: 'ts-esm' },
  // The engine-read seam. `ts-esm` externals every other shared spec (incl. the four au-engine-sdk subpaths
  // it re-exports), so the served file is a thin `export *` barrel with no engine-sdk code inlined.
  '@arsumbris/au-host-sdk/engine-reads': { file: 'au-host-sdk-engine-reads.js', kind: 'ts-esm' },
  // Owns the __AU_CONTAINER_CORE__ global (drag store + placement registry). Externals au-host-sdk; BUNDLES
  // zustand — the drag store's zustand must be the single instance inside this one served copy.
  '@arsumbris/container-core': { file: 'container-core.js', kind: 'ts-esm' },
  // Owns the __AU_HOST_OVERLAY__ global (the overlay channel). Self-contained (deps []).
  '@arsumbris/component-contract': { file: 'component-contract.js', kind: 'ts-esm' },
  // au-engine-sdk subpaths: ONE code-split group. They share `reads.ts` (140kB) / `wire.ts` / `read-helpers`,
  // so building them separately would inline those per file; splitting emits the shared guts as chunks once.
  '@arsumbris/au-engine-sdk/reads': { file: 'au-engine-sdk-reads.js', kind: 'ts-esm-split', group: 'au-engine-sdk' },
  '@arsumbris/au-engine-sdk/subscriptions': { file: 'au-engine-sdk-subscriptions.js', kind: 'ts-esm-split', group: 'au-engine-sdk' },
  '@arsumbris/au-engine-sdk/wikilink': { file: 'au-engine-sdk-wikilink.js', kind: 'ts-esm-split', group: 'au-engine-sdk' },
  '@arsumbris/au-engine-sdk/wire': { file: 'au-engine-sdk-wire.js', kind: 'ts-esm-split', group: 'au-engine-sdk' },
  // The substrate vocab. Pure ESM TS. Each externals the shared siblings it imports (range/selection/
  // au-host-sdk/au-engine-sdk), computed by the ts-esm builder; non-shared deps (type-query) stay bundled.
  '@arsumbris/range': { file: 'range.js', kind: 'ts-esm' },
  '@arsumbris/selection': { file: 'selection.js', kind: 'ts-esm' },
  '@arsumbris/intent': { file: 'intent.js', kind: 'ts-esm' },
  '@arsumbris/preview-content': { file: 'preview-content.js', kind: 'ts-esm' },
  // three.js — esbuild over its ESM build. `require.resolve('three')` returns the CJS entry and its
  // exports map blocks the internal ESM path, so build via an ESM re-export entry to get clean named
  // exports. Self-contained (no shared siblings to external).
  three: { file: 'three.js', kind: 'ts-esm', esmReexport: true },
}

export const SHARED_DEPS: SharedDep[] = SHARED_DEP_SPECIFIERS.map((spec) => {
  const r = RECIPE[spec]
  if (!r) throw new Error(`shared-dep contract lists '${spec}' but app/scripts has no build recipe for it`)
  return { spec, file: r.file, kind: r.kind, external: r.external ?? [], group: r.group, esmReexport: r.esmReexport }
})

/** The `{ imports }` body of the import map, resolving each shared spec to its versioned au-shared:// URL. */
export function sharedDepImports(version: string): Record<string, string> {
  const imports: Record<string, string> = {}
  for (const d of SHARED_DEPS) imports[d.spec] = `au-shared://dep/v${version}/${d.file}`
  return imports
}
