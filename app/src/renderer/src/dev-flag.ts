// Signals the DEV-only shared-dep SPLIT to the shared-dep accessors (overlay / events / diagnostics /
// container-core). Under `pnpm dev` vite serves the SHELL live and rewrites its bare specifiers to vite's
// own copies, so the shell holds a DIFFERENT instance of each shared dep than the projections (which load
// from built dist and resolve to the ONE served au-shared:// instance). The accessors bridge those split
// instances through their window-global ONLY when this flag is set. In a PRODUCTION build every bundle
// shares the one served instance, so the flag is never set and the accessors are plain module singletons —
// the window-globals are gone from the shipped runtime (the point of the platform).
//
// MUST BE THE FIRST IMPORT in main.tsx and surface.tsx: `container-core/singletons.ts` binds its shared
// object EAGERLY at module-eval, so the flag has to be set before that subtree evaluates.

if (import.meta.env.DEV) {
  ;(globalThis as unknown as Record<string, unknown>).__AU_DEV__ = true
}
