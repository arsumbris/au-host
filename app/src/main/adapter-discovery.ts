// Discovers the host's launchable MCP ADAPTER set off the engine, mirroring projection /
// component discovery (`subtypes` read + meta parse + package-root from `source.file`), but
// MAIN-SIDE: main owns launch, holds a DaemonClient per entry, and resolves both the adapter and
// its binary location here (all launch resolution in one place). The renderer picker gets the set
// over IPC (`mcp.listAdapters`).

// A `mcp.adapter` subtype is self-declared in its own
// repo and carries two required metas: `adapter-runtime-meta` (bins + `agentBinary` + contract
// version) and `adapter-presentation-meta` (label + description). IDENTITY is the type NAME, which
// the live adapter reports as `AdapterInfo.harness` — so `def.name` is the selection + join key.

// A subtype with any `unmet_required_meta` is unlaunchable / unpresentable and is SKIPPED — never a
// broken choice. There is NO hard default: `selectAdapter` applies the count rule
// (0 → error, 1 → use it, ≥2 → require an explicit name).



import { readSubtypes } from '@arsumbris/au-engine-sdk/reads'
import type { WireMetaBlock, WireReader, WireSubtype } from '@arsumbris/au-engine-sdk/reads'
import { refName } from '@arsumbris/type-query'

import { packageRootOf } from '../shared/package-root'
import type { DiscoveredAdapter } from '../shared/daemon-api'

/** The abstract base every adapter subtype extends (au-mcp-sdk). */
const BASE_TYPE = 'mcp.adapter'
const RUNTIME_META = 'adapter-runtime-meta'
const PRESENTATION_META = 'adapter-presentation-meta'

function fieldValue(block: WireMetaBlock, name: string): unknown {
  return block.body.find((f) => f.name === name)?.value
}

/** Parse one gated subtype into a `DiscoveredAdapter`, or null if a required meta value is malformed. */
function toAdapter(def: WireSubtype): DiscoveredAdapter | null {
  // Match by BARE name — the served `type_name` is qualified.
  const runtime = def.meta_blocks?.find((b) => refName(b.type_name) === RUNTIME_META)
  const presentation = def.meta_blocks?.find((b) => refName(b.type_name) === PRESENTATION_META)
  if (!runtime || !presentation) return null // the unmet-meta gate should have excluded these already

  const launchEntry = fieldValue(runtime, 'launchEntry')
  const skillsEntry = fieldValue(runtime, 'skillsEntry')
  const injectEntry = fieldValue(runtime, 'injectEntry')
  const contractVersion = fieldValue(runtime, 'contractVersion')
  if (
    typeof launchEntry !== 'string' ||
    typeof skillsEntry !== 'string' ||
    typeof injectEntry !== 'string' ||
    typeof contractVersion !== 'number'
  ) {
    return null
  }
  const agentBinary = fieldValue(runtime, 'agentBinary')
  const label = fieldValue(presentation, 'label')
  const description = fieldValue(presentation, 'description')

  return {
    name: def.name,
    dir: packageRootOf(def.source.file),
    runtime: {
      launchEntry,
      skillsEntry,
      injectEntry,
      contractVersion,
      ...(typeof agentBinary === 'string' ? { agentBinary } : {}),
    },
    label: typeof label === 'string' && label.length > 0 ? label : def.name,
    ...(typeof description === 'string' ? { description } : {}),
  }
}

/**
 * Every launchable adapter: `subtypes('mcp.adapter')`, gated on empty `unmet_required_meta`,
 * name-sorted. Returns [] when the read is not ready or nothing is discovered.
 */
export async function listAdapters(reader: WireReader): Promise<DiscoveredAdapter[]> {
  const result = await readSubtypes(reader, BASE_TYPE)
  if (!('ready' in result) || !result.ready || !result.result) return []
  const out: DiscoveredAdapter[] = []
  for (const def of result.result.subtypes as WireSubtype[]) {
    if (def.unmet_required_meta.length > 0) continue // unlaunchable/unpresentable — never a broken choice
    const adapter = toAdapter(def)
    if (adapter) out.push(adapter)
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/**
 * The count rule (no hard default): pick the adapter to launch/scope with.
 * - a `name` given → that adapter, or an error if it is absent/unlaunchable.
 * - no name: 0 discovered → error; exactly 1 → it; ≥2 → error naming the choices (the caller,
 *   e.g. the launch picker, must pass an explicit name).
 */
export async function selectAdapter(
  reader: WireReader,
  name?: string,
): Promise<{ ok: true; adapter: DiscoveredAdapter } | { ok: false; error: string }> {
  const adapters = await listAdapters(reader)
  if (name) {
    const found = adapters.find((a) => a.name === name)
    return found
      ? { ok: true, adapter: found }
      : { ok: false, error: `adapter '${name}' is not a discovered, launchable mcp.adapter in this workspace` }
  }
  if (adapters.length === 0) {
    return { ok: false, error: 'no launchable mcp.adapter found in this workspace — none is mounted, or each is missing a required meta' }
  }
  if (adapters.length === 1) return { ok: true, adapter: adapters[0] }
  return {
    ok: false,
    error: `multiple adapters available (${adapters.map((a) => a.name).join(', ')}) — choose one`,
  }
}
