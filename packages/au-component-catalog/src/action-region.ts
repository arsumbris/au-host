import type { ActionDescriptor, ContextMenuItem, ContextMenuSurface, MenuHandle } from '@arsumbris/au-host-sdk'

export interface ActionRegionState {
  label: string
  primary?: ActionDescriptor
  actions?: readonly ActionDescriptor[]
  more?: readonly ContextMenuItem[]
  busy?: boolean
  cancel?: ActionDescriptor
}

type ActionElement = HTMLElement & { disabled: boolean; primaryLabel?: string; icon?: string }

/** A presentation-only region. Stable action ids retain their DOM and current callbacks across updates. */
export function createActionRegion(document: Document, menus?: ContextMenuSurface) {
  const element = document.createElement('au-toolbar')
  element.className = 'au-persistent-actions'
  element.setAttribute('aria-label', 'Pane actions')
  const label = document.createElement('span')
  label.className = 'au-persistent-actions-label'
  const actions = document.createElement('au-toolbar-group')
  const more = document.createElement('au-button') as ActionElement
  more.setAttribute('variant', 'ghost')
  more.textContent = 'More'
  const primary = document.createElement('au-viewer-switch') as ActionElement
  const cancel = document.createElement('au-button') as ActionElement
  cancel.setAttribute('variant', 'ghost')
  cancel.dataset.actionRole = 'cancel'
  const nodes = new Map<string, ActionElement>()
  let state: ActionRegionState = { label: '' }
  let menu: MenuHandle | undefined
  let disposed = false
  element.append(label, cancel, actions, more, primary)

  function run(action?: ActionDescriptor, allowBusy = false): void {
    if (!disposed && action?.enabled && (!state.busy || allowBusy)) action.run()
  }
  primary.addEventListener('au-activate', () => run(state.primary))
  cancel.addEventListener('au-activate', () => run(state.cancel, true))
  more.addEventListener('au-activate', () => {
    if (disposed || state.busy || !state.more?.length) return
    menu = menus?.open(more.getBoundingClientRect(), [...state.more])
  })

  function update(next: ActionRegionState): void {
    if (disposed) return
    const ids = next.actions?.map(action => action.id) ?? []
    if (new Set(ids).size !== ids.length) throw new Error('Action region requires unique action ids')
    menu?.close()
    menu = undefined
    state = next
    label.textContent = next.label
    label.title = next.label
    element.setAttribute('aria-busy', String(!!next.busy))
    primary.style.display = next.primary ? '' : 'none'
    primary.primaryLabel = next.primary?.label ?? ''
    primary.disabled = !next.primary?.enabled
    primary.setAttribute('aria-busy', String(!!next.busy))
    more.style.display = next.more?.length && menus ? '' : 'none'
    cancel.style.display = next.cancel ? '' : 'none'
    cancel.textContent = next.cancel?.label ?? ''
    cancel.disabled = !next.cancel?.enabled
    for (const [id, node] of nodes) {
      if (!ids.includes(id)) { node.remove(); nodes.delete(id) }
    }
    let cursor = actions.firstElementChild
    for (const action of next.actions ?? []) {
      let node = nodes.get(action.id)
      if (!node) {
        node = document.createElement('au-button') as ActionElement
        node.setAttribute('variant', 'ghost')
        node.dataset.actionId = action.id
        node.addEventListener('au-activate', () => run(state.actions?.find(candidate => candidate.id === action.id)))
        nodes.set(action.id, node)
      }
      node.textContent = action.label
      node.disabled = !action.enabled
      node.icon = action.icon
      node.title = action.reason ?? action.label
      if (node !== cursor) actions.insertBefore(node, cursor)
      cursor = node.nextElementSibling
    }
  }
  update(state)
  return {
    element,
    update,
    dispose(): void {
      if (disposed) return
      disposed = true
      menu?.close()
      element.remove()
      nodes.clear()
    },
  }
}

export const actionRegionStyle = `
.au-persistent-actions {
  flex: none; height: auto; min-height: calc(var(--au-space-7) + var(--au-space-2) * 2);
  padding: var(--au-space-2) var(--au-space-4); gap: var(--au-space-1);
  background: transparent; border: 0; overflow: visible;
}
.au-persistent-actions-label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--au-ink-3); font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-sans);
}
.au-persistent-actions > :not(.au-persistent-actions-label) { flex: none; }
`
