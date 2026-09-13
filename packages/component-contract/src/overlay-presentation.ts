import type { OverlayLayer } from './overlay-channel'

export type OverlayTokens = Readonly<Record<string, string>>
export interface OverlayTokenScope {
  update(tokens: OverlayTokens): void
  dispose(): void
}
interface Scope {
  tokens: OverlayTokens
  listeners: Set<() => void>
}

/** Presentation follows a trigger across a portal; placement and stacking remain host-owned. */
export class OverlayPresentation {
  private scopes = new WeakMap<Element, Scope>()
  private layers = new WeakMap<Element, Scope[]>()

  provide(root: Element, tokens: OverlayTokens): OverlayTokenScope {
    if (this.scopes.has(root)) throw new Error('An overlay token scope already owns this root')
    const scope: Scope = {tokens: this.validate(tokens), listeners: new Set()}
    this.scopes.set(root, scope)
    let disposed = false
    return {
      update: values => {
        if (disposed) return
        scope.tokens = this.validate(values)
        for (const notify of scope.listeners) notify()
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        this.scopes.delete(root)
        scope.tokens = {}
        for (const notify of scope.listeners) notify()
        scope.listeners.clear()
      },
    }
  }

  private validate(tokens: OverlayTokens): OverlayTokens {
    const copy: Record<string, string> = {}
    for (const [name, value] of Object.entries(tokens)) {
      if ((name.startsWith('--au-') && !name.startsWith('--au-z-')) || name === 'color-scheme') copy[name] = value
      else throw new Error(`Overlay presentation cannot own ${name}`)
    }
    return copy
  }

  private ancestors(from?: Element | null): Scope[] {
    const found: Scope[] = []
    let node: Element | null | undefined = from
    while (node) {
      const scope = this.scopes.get(node)
      if (scope) found.unshift(scope)
      const inherited = this.layers.get(node)
      if (inherited) return [...inherited, ...found]
      const root: Node | undefined = node.getRootNode?.()
      node = node.assignedSlot ?? node.parentElement ?? (root && 'host' in root ? root.host as Element : null)
    }
    return found
  }

  apply(layer: OverlayLayer, from?: Element | null): OverlayLayer {
    const scopes = this.ancestors(from)
    if (!scopes.length) return layer
    const original = new Map<string, {value: string; priority: string}>()
    const style = layer.el.style
    const restore = (name: string): void => {
      const before = original.get(name)!
      if (before.value) style.setProperty(name, before.value, before.priority)
      else style.removeProperty(name)
    }
    const sync = (): void => {
      const values = Object.assign({}, ...scopes.map(scope => scope.tokens)) as Record<string, string>
      for (const name of original.keys()) if (!(name in values)) restore(name)
      for (const [name, value] of Object.entries(values)) {
        if (!original.has(name)) original.set(name, {value: style.getPropertyValue(name), priority: style.getPropertyPriority(name)})
        style.setProperty(name, value)
      }
    }
    this.layers.set(layer.el, scopes)
    for (const scope of scopes) scope.listeners.add(sync)
    sync()
    let released = false
    return {el: layer.el, release: () => {
      if (released) return
      released = true
      for (const scope of scopes) scope.listeners.delete(sync)
      for (const name of original.keys()) restore(name)
      this.layers.delete(layer.el)
      layer.release()
    }}
  }
}
