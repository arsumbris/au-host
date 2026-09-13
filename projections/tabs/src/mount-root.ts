import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

/** Keep React's child tree intact when the enclosing slot is cleared during a parent commit. */
export function mountReactRoot(container: HTMLElement, content: ReactNode): () => void {
  const element = container.ownerDocument.createElement('div')
  element.style.cssText = 'width:100%;height:100%;min-width:0;min-height:0;'
  container.append(element)
  const root = createRoot(element)
  root.render(content)
  return () => {
    root.unmount()
    element.remove()
  }
}
