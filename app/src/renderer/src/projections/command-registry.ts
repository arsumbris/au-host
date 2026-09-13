// THE COMMAND REGISTRY — the discovered set of user-invocable commands, folded from the type graph.
//
// A command IS an intent (see the intent mechanism). An intent becomes a palette command by carrying a
// `command-meta` (label / icon / category / default-binding) on its type-def — carrying that meta is the
// OPT-IN. This folds `subtypes('intent')` (the SAME read discovery + the agent gate already use) into
// descriptors the command palette renders and fires. The command's PARAMS are the intent's own payload
// FIELDS, read from the same pass; the palette builds a typed param-entry step from each field's
// `shape_ast`. Kind / dispatch come from the intent's `intent-routing-meta`, so the palette fires
// GENERICALLY (stamps them onto the payload) with no per-command constructor — the constructors in
// `@arsumbris/intent` exist for INTERNAL firers; the palette is a generic firer.

import { readSubtypes, type WireField, type WireReader, type WireSubtype } from '@arsumbris/au-host-sdk/engine-reads'
import { refName } from '@arsumbris/type-query'

const INTENT_BASE = 'intent'
const COMMAND_META = 'command-meta'
const ROUTING_META = 'intent-routing-meta'

export interface CommandDescriptor {
  /** The bare intent type name — what `host.intent.fire({ type })` fires and a handler keys on. */
  id: string
  qualifiedId: string
  /** Display name, an imperative verb phrase. */
  label: string
  /** Optional leading icon — a component-set glyph NAME today (an unsafe string). The intended shape is a
   *  SEMANTIC role from a shared named enum owned at the intent layer, blocked on the engine's named-enum
   *  feature. The current command-meta schema accepts a string. */
  icon?: string
  /** Optional grouping label (commands sharing a category group in the palette). */
  category?: string
  /** The command's parameters: the intent's own payload fields. Empty for a param-less command. */
  params: WireField[]
  /** Routing kind (`routed` / `broadcast`), read off the intent's `intent-routing-meta`, stamped on the fired payload. */
  kind: string
  /** Routing dispatch (`ambient` / `firer-relative`), when the meta declares one. */
  dispatch?: string
}

/** Fold one meta block's body into a plain record (mirrors discovery.ts's `metaRecord`). */
function metaFields(def: WireSubtype, metaName: string): Record<string, unknown> | undefined {
  const block = def.meta_blocks?.find((b) => refName(b.type_name) === metaName)
  if (!block) return undefined
  const out: Record<string, unknown> = {}
  for (const field of block.body) out[field.name] = field.value
  return out
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** The two folded sets: CURATED commands (an intent carrying a `command-meta`) and the UNREGISTERED
 *  rest (fireable intent subtypes without one). command-meta is the OPT-IN into the curated list; the
 *  unregistered set is the palette's "show unregistered" escape hatch — discovery, not curation. */
export interface CommandSets {
  commands: CommandDescriptor[]
  unregistered: CommandDescriptor[]
}

function descriptorOf(def: WireSubtype, cmd: Record<string, unknown> | undefined): CommandDescriptor {
  const routing = metaFields(def, ROUTING_META) ?? {}
  return {
    id: refName(def.name),
    qualifiedId: def.name.includes('::') ? def.name : `${refName(def.name)}::${def.repo}`,
    // A curated command shows its command-meta label; an unregistered one falls back to the bare type name.
    label: str(cmd?.label) ?? refName(def.name),
    icon: str(cmd?.icon),
    category: str(cmd?.category),
    // The palette's shortcut display is a reverse-lookup over the active keymaps (runtime.shortcutForIntent),
    // not a per-command meta — so it reflects what is ACTUALLY bound.
    // OWN payload fields are the params. Intent ancestors carry no fields today, so own fields ARE the
    // effective params; an intent that ever inherits fields would need effective-shape gathering here.
    params: def.fields ?? [],
    kind: str(routing.kind) ?? 'routed',
    dispatch: str(routing.dispatch),
  }
}

/**
 * Fold the workspace's `intent` subtypes into the two command sets. A one-round-trip read; the caller
 * re-runs it on a `subscribeTypes` tick to keep the palette live. `command-meta` is the opt-in into the
 * curated `commands`; every other concrete intent lands in `unregistered` (the "show unregistered" view).
 */
export async function discoverCommands(reader: WireReader): Promise<CommandSets> {
  const result = await readSubtypes(reader, INTENT_BASE)
  if (!('ready' in result) || !result.ready || !result.result) return { commands: [], unregistered: [] }
  const commands: CommandDescriptor[] = []
  const unregistered: CommandDescriptor[] = []
  for (const def of result.result.subtypes as WireSubtype[]) {
    if (def.abstract) continue // a non-claimable base/intermediate is not a fireable command
    const cmd = metaFields(def, COMMAND_META)
    if (cmd && str(cmd.label)) commands.push(descriptorOf(def, cmd))
    else unregistered.push(descriptorOf(def, undefined))
  }
  const byLabel = (a: CommandDescriptor, b: CommandDescriptor): number =>
    (a.category ?? '').localeCompare(b.category ?? '') || a.label.localeCompare(b.label)
  return { commands: commands.sort(byLabel), unregistered: unregistered.sort(byLabel) }
}
