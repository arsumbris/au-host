// A type's identity as the host keys it: `name::owner`, always qualified.
//
// A type name is not unique across a workspace. Two repos can each own a `tabs` or an `open-intent`, and
// they are distinct types. So every map, set, equality and lookup that decides WHICH type a name means takes
// a `TypeKey`, never a bare name. The owner is the repo that defines the type-def; the closure hash is not
// part of the key, so a key survives edits to the type and its ancestors.
//
// A key is minted in exactly two ways:
//  - `typeKey(authored, fileRepo)`: an authored ref (`tabs` or `tabs::tabs`) plus the repo of the file that
//    wrote it. A bare name resolves in that file's own repo, the engine's own resolution rule.
//  - `keyOf({ name, repo })`: a type identity the engine returned (a type result, an `origin`, a `from`).
// The brand makes a bare string a compile error wherever a key is expected. At runtime it is a plain string,
// so it serializes, logs, and keys a `Map` as is.

declare const TYPE_KEY: unique symbol

/** A type's identity, `name::owner`. Mint with `typeKey` or `keyOf`, never by a cast. The one exception is a
 *  vocabulary package's constants for the types it owns, written as literals (e.g. `intent`'s
 *  `'open-intent::intent' as TypeKey`) so it needs no runtime dependency on this SDK. */
export type TypeKey = string & { readonly [TYPE_KEY]: true }

/** The repo that owns this SDK's type vocabulary. */
export const SDK_REPO = 'au-host-sdk'

/**
 * The key an authored ref means, read from a file in `fileRepo`. `name::repo` is taken as written; a bare
 * `name` resolves in `fileRepo`. A leading `[[` / trailing `]]` is not accepted: parse the wikilink first.
 */
export function typeKey(authored: string, fileRepo: string): TypeKey {
  const i = authored.indexOf('::')
  if (i < 0) return `${authored}::${fileRepo}` as TypeKey
  const repo = authored.slice(i + 2)
  return (repo ? authored : `${authored.slice(0, i)}::${fileRepo}`) as TypeKey
}

/** The key of a type identity the engine returned: a type result, a field `origin`, a meta block's `from`. */
export function keyOf(identity: { name: string; repo: string }): TypeKey {
  return `${identity.name}::${identity.repo}` as TypeKey
}

/** The bare type name, for display only. Never compare or key by it. */
export function nameOf(key: TypeKey): string {
  return key.slice(0, key.indexOf('::'))
}

/** The repo that owns the type. */
export function ownerOf(key: TypeKey): string {
  return key.slice(key.indexOf('::') + 2)
}

/** The form to WRITE into a file of `fileRepo`: bare when that repo owns the type, qualified otherwise. */
export function authoredRef(key: TypeKey, fileRepo: string): string {
  return ownerOf(key) === fileRepo ? nameOf(key) : key
}

/** The keys of a meta type on an `effective_meta` entry: one per repo that defines that identity. An
 *  unresolved meta type has no owners and so no keys. */
export function metaTypeKeys(metaType: { name: string; type_owners: readonly string[] }): TypeKey[] {
  return metaType.type_owners.map((repo) => keyOf({ name: metaType.name, repo }))
}

/** The slice of a type view that carries the engine's EFFECTIVE meta. A `WireTypeDef` satisfies it. */
export interface EffectiveMetaView<B> {
  readonly effective_meta: ReadonlyArray<{ meta_type: { name: string; type_owners: readonly string[] }; blocks: readonly B[] }>
}

/** Every surviving block of meta type `key` on a type: its own, else the ones it inherits. More than one
 *  is a conflict or a duplicate the engine reports whole (`meta-inheritance-conflict`, `duplicate-meta-block`). */
export function metaBlocks<B>(def: EffectiveMetaView<B>, key: TypeKey): readonly B[] {
  return def.effective_meta.find((m) => metaTypeKeys(m.meta_type).includes(key))?.blocks ?? []
}

/** The one block of meta type `key` a type carries, own or inherited. Undefined when it carries none, or
 *  several: the engine reports that conflict, and the host picks no winner. */
export function metaBlock<B>(def: EffectiveMetaView<B>, key: TypeKey): B | undefined {
  const blocks = metaBlocks(def, key)
  return blocks.length === 1 ? blocks[0] : undefined
}

/** What a type declares for a CODE-POINTING meta (a runtime `entry`), which is never looked up from an
 *  ancestor: a type loads only code it declares itself.
 *  - `own`: its own single block, the one to load, resolved against the type's own package.
 *  - `absent`: no block anywhere and nothing required, so the type is simply not loadable code.
 *  - `not-own`: a concrete type that looks loadable and is not. It carries only an ancestor's block, or
 *    several of its own, or the engine reports a required meta unmet. `reason` says why, for the author. */
export type CodeMeta<B> = { kind: 'own'; block: B } | { kind: 'absent' } | { kind: 'not-own'; reason: string }

/** The slice of a type view `codeMetaBlock` reads. A `WireTypeDef` satisfies it. */
export interface CodeMetaView<B> extends EffectiveMetaView<B> {
  readonly name: string
  readonly repo: string
  readonly unmet_required_meta: readonly string[]
}

/** A type's own block of code-pointing meta type `key`, never an ancestor's. See `CodeMeta`. */
export function codeMetaBlock<B extends { readonly from: { readonly name: string; readonly repo: string } }>(
  def: CodeMetaView<B>,
  key: TypeKey,
): CodeMeta<B> {
  const blocks = metaBlocks(def, key)
  const own = blocks.filter((b) => b.from.name === def.name && b.from.repo === def.repo)
  const meta = nameOf(key)
  const unmet = def.unmet_required_meta.length > 0 ? ` The engine reports required meta unmet: ${def.unmet_required_meta.join(', ')}.` : ''
  if (own.length === 1) return { kind: 'own', block: own[0] }
  if (own.length > 1) return { kind: 'not-own', reason: `declares ${own.length} \`${meta}\` blocks; keep one.${unmet}` }
  if (blocks.length > 0) {
    const from = blocks.map((b) => keyOf(b.from)).join(', ')
    return { kind: 'not-own', reason: `declares no \`${meta}\` of its own, and an ancestor's (${from}) is never loaded for it. Declare its own block, or mark it abstract.${unmet}` }
  }
  if (unmet) return { kind: 'not-own', reason: `declares no \`${meta}\`.${unmet}` }
  return { kind: 'absent' }
}

/** Whether a descriptor's kind closure includes `kind`. Membership is by closure, never by exact type. */
export function hasKind(descriptor: { readonly kinds: readonly TypeKey[] }, kind: TypeKey): boolean {
  return descriptor.kinds.includes(kind)
}

const sdk = (name: string): TypeKey => keyOf({ name, repo: SDK_REPO })

// The projection kinds.
export const PROJECTION = sdk('projection')
export const PANE_PROJECTION = sdk('pane-projection')
export const CONTAINER_PROJECTION = sdk('container-projection')
export const GROUPING_CONTAINER = sdk('grouping-container')
export const SPATIAL_CONTAINER = sdk('spatial-container')
export const FRAME_CONTAINER = sdk('frame-container')
export const BAR_PROJECTION = sdk('bar-projection')
export const BAR_ITEM_PROJECTION = sdk('bar-item-projection')
export const PLACEHOLDER_PROJECTION = sdk('placeholder-projection')

// The structural types a composition is built from.
export const MOUNTABLE = sdk('mountable')
export const CONTAINER_NODE = sdk('container-node')
export const CONTAINER_SLOT = sdk('container-slot')
export const COMPOSITION = sdk('composition')
export const WINDOW = sdk('window')

// The meta types a projection type-def declares.
export const PROJECTION_RUNTIME_META = sdk('projection-runtime-meta')
export const PROJECTION_PRESENTATION_META = sdk('projection-presentation-meta')
export const ARITY_META = sdk('arity-meta')
export const HANDLES_INTENT_META = sdk('handles-intent-meta')
export const FIRES_INTENT_META = sdk('fires-intent-meta')
export const INTENT_ROUTING_META = sdk('intent-routing-meta')
export const COMMAND_META = sdk('command-meta')
export const OPENS_META = sdk('opens-meta')
export const RAW_TEXT_SURFACE_META = sdk('raw-text-surface-meta')
export const BREAKPOINTS_META = sdk('breakpoints-meta')
