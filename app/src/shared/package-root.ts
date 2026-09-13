// The package root of a discovered type-def, derived from its `source.file`.
//
// A type-def sits at `<pkg>/type/<file>.type.yaml`; a discovered subtype's owning
// package root is that path with the `/type/<file>` tail stripped. This is how the
// host locates a discovered node's loadable code / bins (projections, components,
// grouping, notification renderers, mcp adapters) — the package the subtype's owner
// repo mounts. Pure and DOM-free, so a node probe can exercise the discovery modules
// that use it without dragging in renderer-only code.

/** `<pkg>/type/<file>.type.yaml` -> `<pkg>`. */
export function packageRootOf(sourceFile: string): string {
  const dir = sourceFile.slice(0, Math.max(0, sourceFile.lastIndexOf('/')))
  return dir.slice(0, Math.max(0, dir.lastIndexOf('/')))
}
