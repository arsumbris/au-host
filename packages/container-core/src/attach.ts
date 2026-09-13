/**
 * Register a container with the substrate without depending on a UI framework.
 * This manages placement, dialect, lifecycle and stable delegation. React hooks share this path,
 * so the router receives the same container contract from vanilla and React implementations.
 */

import type { ContainerDialect, ContainerPlacement } from '@arsumbris/au-host-sdk';
import { registerContainer, deregisterContainer, registerDialect, deregisterDialect } from './registry.ts';

/** What a container declares about itself. `dialect` is optional: a container that never
 *  participates in drag still wants a placement (so intents and pane lookup reach it). */
export interface ContainerDeclaration {
  placement: ContainerPlacement
  dialect?: ContainerDialect
}

export interface ContainerAttachment {
  /**
   * Swap in a newly-built declaration WITHOUT re-registering. A container whose placement closes
   * over live state rebuilds that object on every change; re-registering each time would thrash
   * the registry and drop in-flight drags. The substrate only ever sees the stable proxy.
   */
  update: (next: Partial<ContainerDeclaration>) => void
  /** Deregister. Idempotent, so a double-teardown is safe. */
  detach: () => void
}

/**
 * A stable façade over a slot that keeps changing identity.
 *
 * A REAL `Proxy`, not a hand-listed literal of forwarders. The seams can grow (`ContainerDialect` carries an optional `onDragOver`), and a literal silently drops
 * every member nobody remembered to list — silently, because an absent OPTIONAL member reads as
 * "this container does not implement it" rather than as a bug. And since the router only ever sees
 * this façade, a forgotten line would make the member invisible for EVERY container at once.
 *
 * Forwarding by `get` also keeps ABSENCE absent: a container with no `onDragOver` proxies to
 * `undefined`, which is exactly what the router probes for with `?.()`. Functions are bound to the
 * LIVE target so a container authored as a class keeps its `this`.
 *
 * EXPORTED because the React hooks need the identical property. They register their own stable
 * façade over a `useRef`. One implementation, so a member added to the seam cannot be forwarded by one path and dropped by
 * the other.
 */
export function stableFacade<T extends object>(read: () => T | undefined): T {
  return new Proxy({} as T, {
    get: (_target, key): unknown => {
      const current = read();
      if (!current) return undefined;
      const member: unknown = Reflect.get(current, key);
      return typeof member === 'function' ? member.bind(current) : member;
    },
  });
}

/**
 * Declare a container to the substrate, framework-free.
 *
 * ```ts
 * const attached = attachContainer(rootEl, { placement, dialect })
 * // ... later, when the container's model changes:
 * attached.update({ placement: rebuiltPlacement })
 * // ... on teardown:
 * attached.detach()
 * ```
 */
export function attachContainer(el: Element, declaration: ContainerDeclaration): ContainerAttachment {
  let current: ContainerDeclaration = declaration;
  let attached = true;

  registerContainer(el, stableFacade(() => current.placement));
  // Registered only when one was declared, so a container without a dialect stays absent from the
  // dialect registry rather than present-but-empty — the resolver skips it either way, but an
  // empty registration would read as "declares a dialect that emits nothing".
  if (current.dialect) registerDialect(el, stableFacade(() => current.dialect));

  return {
    update: (next) => {
      if (!attached) return;
      const hadDialect = current.dialect !== undefined;
      current = { ...current, ...next };
      // A dialect can arrive LATE (a container that renders an empty view first), so register on
      // the transition rather than assuming the initial declaration was complete.
      if (!hadDialect && current.dialect) registerDialect(el, stableFacade(() => current.dialect));
    },
    detach: () => {
      if (!attached) return;
      attached = false;
      deregisterContainer(el);
      deregisterDialect(el);
    },
  };
}
