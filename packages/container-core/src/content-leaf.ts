import type { MountHost, OpaqueConfig } from '@arsumbris/au-host-sdk'

/**
 * Content ENTERS the pool, so the HOST assigns its `^:` pool id. A container that creates a
 * genuinely-new child hands the host the content and gets back the id, then holds it as a REFERENCE
 * unit ({ id, instance }, id and content COUPLED). The container never mints a pool id: it asks.
 *
 * WHY THIS CLOSES THE FOOTGUN. A pool `^:` is the identity a child's config lives under in the
 * host-owned pool, referenced `[[^^id]]`. When a container held content INLINE with the id as an
 * OPTIONAL sidecar, "content without a pool id" was representable: RENDER fell back to the position id
 * while SERIALIZE minted a fresh one, so the parent referenced a ghost the reaper deleted — a
 * non-local, catastrophic collapse. Holding the reference unit makes that state
 * unrepresentable, and because the id the container holds IS the one the host pooled, render (resolve
 * `^:` → mount) and serialize (write `^:`) name the child the SAME way — they cannot disagree.
 *
 *
 * Every host that mounts a container HAS a pool: the authority (`mountRootPortal` wires it before any
 * container mounts) and a surface (the mount agent's proxied pool, always present). So a container
 * that reaches here always gets a host-assigned id. A missing pool is a broken host, not a fallback
 * path — it THROWS, loudly, rather than substrate-minting an id the pool never knows about (which would
 * re-open the ghost-collapse footgun above). Only genuinely-new content calls this; a move / close /
 * re-parent reuses an existing id, and a synthesized record (a centre-wrap group) is substrate-minted
 * (`mintBlockId`), the case `block-id.ts` endorses — a non-container-scheme id.
 */
export function createChild(host: MountHost, instance: unknown, opts?: { transient?: boolean }): string {
  const id = host.children.pool?.createRecord(instance as OpaqueConfig, opts)
  if (id === undefined) {
    throw new Error('createChild: the host exposes no composition pool — a container cannot create pooled content without one')
  }
  return id
}
