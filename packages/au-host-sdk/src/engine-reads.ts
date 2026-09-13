// The renderer's single seam for the engine READ vocabulary.
//
// Projections, the host shell, and renderer-side vocab packages read the engine graph
// through this subpath (`@arsumbris/au-host-sdk/engine-reads`) instead of importing
// au-engine-sdk directly. So a renderer consumer names only au-host-sdk in its
// package.json, and the au-projections repo extracts without dragging au-engine-sdk
// across the boundary.
//
// This is a THIN passthrough. au-engine-sdk stays a served shared-dep (one instance);
// each specifier below is external at build time and resolves through the import map to
// that one instance, so this file bundles no engine-sdk code. The engine `DaemonClient`
// (au-engine-sdk's main entry) is NOT re-exported here: it is the node socket client and
// stays main-process only.
//
// The four subpaths carry disjoint export names, so `export *` is unambiguous. `Wire*`
// types come from `/reads`, not `/wire` (`/wire` carries the frame / ReadRequest /
// WireError surface).

export * from '@arsumbris/au-engine-sdk/reads'
export * from '@arsumbris/au-engine-sdk/subscriptions'
export * from '@arsumbris/au-engine-sdk/wikilink'
export * from '@arsumbris/au-engine-sdk/wire'
