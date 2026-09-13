interface RenderNode {
  type: string
  position?: {start: {offset?: number}; end: {offset?: number}}
  properties?: Record<string, unknown>
  children?: RenderNode[]
}

/** Keep Markdown's source locations on its rendered elements for range navigation. */
export function sourceLocations(source: string, bodyOffset: number) {
  const bytes = (offset: number) => new TextEncoder().encode(source.slice(0, bodyOffset + offset)).length
  return () => (tree: RenderNode): void => {
    const visit = (node: RenderNode): void => {
      if (node.type === 'element' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
        node.properties = {...node.properties, 'data-source-from': bytes(node.position.start.offset), 'data-source-to': bytes(node.position.end.offset)}
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

export function closestSourceElement(root: HTMLElement, from: number): HTMLElement | undefined {
  const elements = [...root.querySelectorAll<HTMLElement>('[data-source-from]')]
  const containing = elements.filter(element => Number(element.dataset.sourceFrom) <= from && Number(element.dataset.sourceTo) >= from)
  if (containing.length) return containing.sort((a, b) => (Number(a.dataset.sourceTo) - Number(a.dataset.sourceFrom)) - (Number(b.dataset.sourceTo) - Number(b.dataset.sourceFrom)))[0]
  return elements.sort((a, b) => Math.abs(Number(a.dataset.sourceFrom) - from) - Math.abs(Number(b.dataset.sourceFrom) - from))[0]
}
