// Reads keymap FILES into the resolver-ready `RawKeymap` shape, and resolves a composition's `keymaps`
// list (an ordered set of references) to those keymaps. The runtime's authority-side dispatch reads the
// active keymaps through `CompositionRuntimeOptions.activeKeymaps`, which this backs.


import { readInstancesOf, type WireReader } from '@arsumbris/au-host-sdk/engine-reads'
import { bareTypeName, event, on, type RawKeymap, type RawKeybind, type CanonicalKeystroke, type KeyName, type KeyModifier } from '@arsumbris/au-host-sdk'
import type { CommandSets } from './command-registry'

/** The bare target name of a wikilink reference value (`[[save-intent::intent]]` -> `save-intent`), or a
 *  parsed ref object, or a bare string. `undefined` when it carries no resolvable name. */
function refName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const m = /\[\[([^\]]+)\]\]/.exec(value)
    return bareRefTarget(m ? m[1] : value)
  }
  if (value && typeof value === 'object') {
    const t = (value as Record<string, unknown>).target ?? (value as Record<string, unknown>).name
    if (typeof t === 'string') return bareRefTarget(t)
  }
  return undefined
}

/** Strip a `::repo` scope, a `#head` / `^block` fragment, and any path, leaving the basename stem. */
function bareRefTarget(target: string): string {
  const noRepo = bareTypeName(target).trim()
  const base = noRepo.split('/').pop() ?? noRepo
  return base.replace(/[#^].*$/, '').trim()
}

/** A keymap file's name, its basename minus the file extension (`default.keymap.yaml` -> `default.keymap`). */
function keymapName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.(md|ya?ml)$/i, '')
}

function parseKeystroke(rec: unknown): CanonicalKeystroke | null {
  if (!rec || typeof rec !== 'object') return null
  const r = rec as Record<string, unknown>
  if (typeof r.key !== 'string') return null
  const mods = (Array.isArray(r.mods) ? r.mods : []).filter((m): m is string => typeof m === 'string')
  return { key: r.key as KeyName, mods: mods as KeyModifier[] }
}

function parseWhen(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map(refName).filter((x): x is string => !!x)
  return out.length ? out : undefined
}

function parseKeybind(rec: unknown): RawKeybind | null {
  if (!rec || typeof rec !== 'object') return null
  const r = rec as Record<string, unknown>
  const chord = (Array.isArray(r.chord) ? r.chord : []).map(parseKeystroke).filter((x): x is CanonicalKeystroke => !!x)
  const intent = refName(r.intent)
  if (chord.length === 0 || !intent) return null
  return { chord, intent, when: parseWhen(r.when) }
}

/** Read every keymap file into a map keyed by keymap name. */
export async function readKeymaps(reader: WireReader): Promise<Map<string, RawKeymap>> {
  const map = new Map<string, RawKeymap>()
  const keptPath = new Map<string, string>()
  const result = await readInstancesOf(reader, 'keymap', { origins: ['file'] })
  if (!('ready' in result) || !result.ready || !result.result) return map
  for (const inst of result.result as { path: string; fields?: Record<string, unknown> }[]) {
    const name = keymapName(inst.path)
    if (map.has(name)) {
      // Stem-keying is the reference contract, so first-wins is intentional — but a real second file
      // dropped is a surprise, so surface it over the event substrate rather than silently.
      if (on('keybind')) event('keybind', 'keymap-name-collision', { name, kept: keptPath.get(name), dropped: inst.path })
      continue
    }
    keptPath.set(name, inst.path)
    const keybinds = (Array.isArray(inst.fields?.keybinds) ? inst.fields!.keybinds : [])
      .map(parseKeybind)
      .filter((x): x is RawKeybind => !!x)
    map.set(name, { when: parseWhen(inst.fields?.when), keybinds })
  }
  return map
}

/** Resolve a composition's `keymaps` reference list to the ordered active keymaps. */
export function activeKeymapsFor(
  composition: Record<string, unknown> | null | undefined,
  all: Map<string, RawKeymap>,
): RawKeymap[] {
  const refs = Array.isArray(composition?.['keymaps']) ? (composition!['keymaps'] as unknown[]) : []
  const out: RawKeymap[] = []
  for (const ref of refs) {
    const name = refName(ref)
    const km = name ? all.get(name) : undefined
    if (km) out.push(km)
  }
  return out
}

/** The routing (`kind` / `dispatch`) for an intent type, from the discovered command registry. */
export function commandRoutingFor(sets: CommandSets, intent: string): { kind: string; dispatch?: string } | null {
  const all = [...sets.commands, ...sets.unregistered]
  const desc = all.find((c) => bareTypeName(c.id) === bareTypeName(intent))
  return desc ? { kind: desc.kind, dispatch: desc.dispatch } : null
}
