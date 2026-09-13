// The host's shared-dependency CONTRACT: the bare specifiers every renderer bundle — the app shell, every
// projection, and every component set — builds `external`, so they resolve at runtime to the ONE served
// instance per dep (through the host's injected import map) instead of bundling their own copy.
//
// BUILD-FACING. Imported by vite/rollup configs, NEVER at runtime — `au-host-sdk`'s own runtime bundle
// (src/index.ts) does not touch this module. It lives here, on the SDK every projection already depends on,
// so the set is one PUBLISHED contract an out-of-tree author externalizes the same way, with no extra
// dependency. (The host's build RECIPE — which file each maps to, and how it is built — is app-owned.)

/** The shared-dep specifiers. Adding one here means: build it (host), map it, and every bundle externals it. */
export const SHARED_DEP_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@arsumbris/au-host-sdk',
  // The renderer's engine-read seam: a THIN re-export of the au-engine-sdk renderer subpaths (below), so a
  // projection reads the engine graph naming only au-host-sdk. Externals engine-sdk, so it bundles no engine
  // code and resolves to the one served engine-sdk instance.
  '@arsumbris/au-host-sdk/engine-reads',
  '@arsumbris/container-core',
  '@arsumbris/component-contract',
  // au-engine-sdk: the renderer imports only these SUBPATHS at runtime (the main entry is the node daemon
  // client, main-process only). Built as ONE code-split group so the shared internal guts (reads/wire) are
  // emitted once, not duplicated per subpath.
  '@arsumbris/au-engine-sdk/reads',
  '@arsumbris/au-engine-sdk/subscriptions',
  '@arsumbris/au-engine-sdk/wikilink',
  '@arsumbris/au-engine-sdk/wire',
  // The substrate vocab packages. Pure (no module state), so this is dedup-only — correctness held with
  // per-bundle copies; sharing just drops the duplicate copies from every consumer.
  '@arsumbris/range',
  '@arsumbris/selection',
  '@arsumbris/intent',
  '@arsumbris/preview-content',
  // three.js: the 3D renderer. A pure ESM library with module state (its WebGL caches, the type
  // registries), so sharing ONE served instance is correctness as well as dedup — a projection and a
  // future 3D component must not each carry their own three. Served from three's ESM build.
  'three',
] as const

const SHARED = new Set<string>(SHARED_DEP_SPECIFIERS)

/** A rollup/vite `external` predicate: true for a shared-dep specifier a bundle must NOT inline. */
export function sharedDepExternal(id: string): boolean {
  return SHARED.has(id)
}
