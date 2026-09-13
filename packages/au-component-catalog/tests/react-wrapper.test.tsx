// @vitest-environment happy-dom

// The GATE for the React wrapper generator: it must PRESERVE live component-set discovery + swap. The
// whole reason the `<au-*>` layer exists is that a projection references a component by TAG, and
// whichever set the host registers under that tag defines it — a third party ships their own set and it
// wins the tag. A wrapper that pinned a set's class would break this. These tests prove it does not.


import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { makeAuWrapper } from '../src/react-runtime.ts'

// @ts-expect-error React's act-environment flag is not typed on globalThis
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; host: HTMLElement }> = []
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    void act(() => root.unmount())
    host.remove()
  }
})

async function render(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  mounted.push({ root, host })
  return host
}

describe('makeAuWrapper — the swap-preservation gate', () => {
  it('renders the class the REGISTRY defines under the tag (a swapped-in set wins)', async () => {
    // Stand-in for whatever set the host serves for this tag.
    class SetAImpl extends HTMLElement {
      readonly whichSet = 'A'
    }
    customElements.define('au-swap-proof-a', SetAImpl)
    const Wrapped = makeAuWrapper<{ open?: boolean }>('au-swap-proof-a', ['open'], {})

    const host = await render(<Wrapped open />)
    const el = host.querySelector('au-swap-proof-a')

    expect(el).toBeInstanceOf(SetAImpl) // the registry's class won — the wrapper pinned nothing
  })

  it('a DIFFERENT class under a DIFFERENT tag also wins — no class is ever baked in', async () => {
    class SetBImpl extends HTMLElement {
      readonly whichSet = 'B'
    }
    customElements.define('au-swap-proof-b', SetBImpl)
    const Wrapped = makeAuWrapper('au-swap-proof-b', [], {})

    const host = await render(<Wrapped />)
    expect(host.querySelector('au-swap-proof-b')).toBeInstanceOf(SetBImpl)
  })

  it('sets a declared field as a PROPERTY (not a JSX attribute) — the dashed-attr fix', async () => {
    class FieldImpl extends HTMLElement {}
    customElements.define('au-field-proof', FieldImpl)
    const Wrapped = makeAuWrapper<{ chevronEnd?: boolean }>('au-field-proof', ['chevronEnd'], {})

    const host = await render(<Wrapped chevronEnd />)
    const el = host.querySelector('au-field-proof') as HTMLElement & { chevronEnd?: boolean }

    expect(el.chevronEnd).toBe(true) // reached the element as a property
    expect(el.hasAttribute('chevron-end')).toBe(false) // never the attribute path React mishandles
  })

  it('wires a declared event to its onAuXxx handler', async () => {
    class EventImpl extends HTMLElement {}
    customElements.define('au-event-proof', EventImpl)
    const onAuToggle = vi.fn()
    const Wrapped = makeAuWrapper<{ onAuToggle?: (e: CustomEvent) => void }>('au-event-proof', [], {
      onAuToggle: 'au-toggle',
    })

    const host = await render(<Wrapped onAuToggle={onAuToggle} />)
    const el = host.querySelector('au-event-proof') as HTMLElement
    el.dispatchEvent(new CustomEvent('au-toggle', { detail: { x: 1 } }))

    expect(onAuToggle).toHaveBeenCalledTimes(1)
  })

  it('passes standard DOM props straight through, without setting them as element fields', async () => {
    class PassImpl extends HTMLElement {}
    customElements.define('au-pass-proof', PassImpl)
    const Wrapped = makeAuWrapper<{ open?: boolean }>('au-pass-proof', ['open'], {})

    const host = await render(
      <Wrapped open className="rail" data-path="/x" tabIndex={0}>
        label
      </Wrapped>,
    )
    const el = host.querySelector('au-pass-proof') as HTMLElement

    expect(el.className).toBe('rail')
    expect(el.getAttribute('data-path')).toBe('/x')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.textContent).toBe('label')
  })
})

describe('the GENERATED wrappers reference no set class (structural gate)', () => {
  // cwd is the package root under vitest; happy-dom makes import.meta.url a non-file URL.
  const src = readFileSync(resolve('src/react.ts'), 'utf8')

  it('imports no component-set implementation', () => {
    expect(src).not.toMatch(/au-component-set/)
    // No element-class import (a set exports `Au…Element` classes; the wrapper must never pull one in).
    expect(src).not.toMatch(/import[^\n]*Element[\s,}]/)
  })

  it('creates every wrapper from a tag STRING literal', () => {
    const tags = [...src.matchAll(/makeAuWrapper<[^>]+>\('([^']+)'/g)].map((m) => m[1])
    expect(tags.length).toBeGreaterThan(30) // the full catalog
    for (const tag of tags) expect(tag).toMatch(/^au-[a-z-]+$/)
  })
})
