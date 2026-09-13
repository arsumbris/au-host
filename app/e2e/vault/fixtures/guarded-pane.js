import { defineProjection } from '@arsumbris/au-host-sdk'

export default defineProjection({
  mount(container, host) {
    const buffer = document.createElement('input')
    buffer.className = 'hello-buffer'
    buffer.setAttribute('aria-label', 'Unsaved test buffer')
    container.append(buffer)
    const dispose = host.closeGuard.register(() => buffer.value.trim().length === 0)
    return () => { dispose(); container.replaceChildren() }
  },
})
