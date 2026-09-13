// Tree-scoped view-state exposed through `MountHost.viewState`.
// Publishers share standing values through the channel; consumers subscribe to the relevant scope.

import type { MountHost, PublisherId } from '@arsumbris/au-host-sdk'

type Listener = (value: unknown) => void
type AllListener = (publisher: PublisherId, value: unknown) => void

export class ViewStateBus {
  // publisher -> slice -> last value
  private readonly values = new Map<PublisherId, Map<string, unknown>>()
  // publisher -> slice -> followers
  private readonly followers = new Map<PublisherId, Map<string, Set<Listener>>>()
  // slice -> watch-all watchers (follow the slice across every publisher)
  private readonly allWatchers = new Map<string, Set<AllListener>>()
  // owner -> the disposers for the follows/watches that owner PLACED on others.
  // Lets dropPublisher sweep a node's OUTBOUND subscriptions, so a node that
  // unmounts without calling its disposer cannot leak a listener on a sibling.
  private readonly placed = new Map<PublisherId, Set<() => void>>()

  /** A viewState surface bound to one projection's identity (its own `publish`). */
  forPublisher(publisher: PublisherId): MountHost['viewState'] {
    return {
      publish: (slice, value) => this.publish(publisher, slice, value),
      follow: (target, slice, onValue) => this.follow(publisher, target, slice, onValue),
      watchAll: (slice, onValue) => this.watchAll(publisher, slice, onValue),
    }
  }

  private publish(publisher: PublisherId, slice: string, value: unknown): void {
    let slices = this.values.get(publisher)
    if (!slices) {
      slices = new Map()
      this.values.set(publisher, slices)
    }
    slices.set(slice, value)
    const subs = this.followers.get(publisher)?.get(slice)
    if (subs) for (const listener of [...subs]) listener(value)
    const watchers = this.allWatchers.get(slice)
    if (watchers) for (const w of [...watchers]) w(publisher, value)
  }

  /** Record an outbound disposer under its owner, and return a wrapper that runs it at
   *  most once and forgets it — whether the projection calls it or dropPublisher sweeps it. */
  private track(owner: PublisherId, dispose: () => void): () => void {
    let owned = this.placed.get(owner)
    if (!owned) {
      owned = new Set()
      this.placed.set(owner, owned)
    }
    const set = owned
    const wrapped = (): void => {
      if (!set.has(wrapped)) return
      set.delete(wrapped)
      dispose()
    }
    set.add(wrapped)
    return wrapped
  }

  /** Watch a slice across ALL publishers: deliver each publisher's current value, then every
   *  publish; deliver `undefined` for a publisher when it drops (unmounts). Returns unsubscribe. */
  private watchAll(owner: PublisherId, slice: string, onValue: AllListener): () => void {
    for (const [publisher, slices] of this.values) {
      if (slices.has(slice)) onValue(publisher, slices.get(slice))
    }
    let subs = this.allWatchers.get(slice)
    if (!subs) {
      subs = new Set()
      this.allWatchers.set(slice, subs)
    }
    const set = subs
    set.add(onValue)
    return this.track(owner, () => set.delete(onValue))
  }

  private follow(owner: PublisherId, publisher: PublisherId, slice: string, onValue: Listener): () => void {
    // Deliver the current value if one has been published.
    const slices = this.values.get(publisher)
    if (slices?.has(slice)) onValue(slices.get(slice))

    let bySlice = this.followers.get(publisher)
    if (!bySlice) {
      bySlice = new Map()
      this.followers.set(publisher, bySlice)
    }
    let subs = bySlice.get(slice)
    if (!subs) {
      subs = new Set()
      bySlice.set(slice, subs)
    }
    const set = subs
    set.add(onValue)
    return this.track(owner, () => set.delete(onValue))
  }

  /** A publisher unmounted: drop the follows/watches it PLACED, then its own slices and the
   *  follows targeting it. The outbound sweep is what defends against a skipped disposer. */
  dropPublisher(publisher: PublisherId): void {
    // 1. Tear down everything this node subscribed to elsewhere (outbound).
    const placed = this.placed.get(publisher)
    if (placed) {
      for (const dispose of [...placed]) dispose()
      this.placed.delete(publisher)
    }
    // 2. Tell watch-all watchers the publisher's slices are gone (undefined) so they forget it.
    const slices = this.values.get(publisher)
    if (slices) {
      for (const slice of slices.keys()) {
        const watchers = this.allWatchers.get(slice)
        if (watchers) for (const w of [...watchers]) w(publisher, undefined)
      }
    }
    this.values.delete(publisher)
    this.followers.delete(publisher) // ending the follow = no further delivery
  }
}
