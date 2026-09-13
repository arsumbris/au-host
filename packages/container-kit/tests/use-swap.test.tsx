// @vitest-environment happy-dom
// Pane swapping preserves the slot and honors its fixity rules through the shared placement seam.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MountHost, ProjectionDescriptor } from '@arsumbris/au-host-sdk'

// Mock the container-core SEAM: a swap resolves no real container in happy-dom, so stub the placement
// lookup (null → a null slot admits everything) and `setPaneContent` (the write the pick performs).
// Everything else — `descriptorLabel` / `refToTypeName` that PanePicker needs — passes through.
vi.mock('@arsumbris/container-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arsumbris/container-core')>()),
  placementForPane: () => null,
  setPaneContent: vi.fn(),
}))

import { setPaneContent } from '@arsumbris/container-core'
import { usePaneSwap } from '../src/use-swap'

// @ts-expect-error React's act-environment flag is not typed on globalThis
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const host = {
  describeProjections: (): ProjectionDescriptor[] => [{ type: 'editor-pane', repo: 'r', kinds: ['pane-projection'] }],
  listProjections: () => ['editor-pane'],
} as unknown as MountHost

function Harness({ current }: { current: { type?: string; file?: string } }): ReactElement {
  const swap = usePaneSwap(host)
  return (
    <div>
      <button data-testid="toggle" onClick={() => swap.toggle('slot1')}>
        toggle
      </button>
      <span data-testid="state">{swap.isSwapping('slot1') ? 'swapping' : 'idle'}</span>
      {swap.isSwapping('slot1') ? swap.swapPicker('slot1', current) : null}
    </div>
  )
}

let container: HTMLElement
let root: Root

function mount(ui: ReactElement): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(ui))
}
function click(el: Element | null): void {
  act(() => (el as HTMLElement | null)?.click())
}
const state = (): string | null | undefined => container.querySelector('[data-testid="state"]')?.textContent

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(setPaneContent).mockReset()
  // happy-dom does not implement scrollIntoView, which the picker calls on its active row.
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => act(() => root.unmount()))

describe('usePaneSwap', () => {
  it('toggle opens the swap picker', () => {
    mount(<Harness current={{ type: 'aup-reader', file: '/a.md' }} />)
    expect(state()).toBe('idle')
    click(container.querySelector('[data-testid="toggle"]'))
    expect(state()).toBe('swapping')
    expect(container.querySelector('input')).not.toBeNull() // the picker's search box is present
  })

  it('a pick drives the seam with the current file carried onto the new type, and closes on accept', () => {
    vi.mocked(setPaneContent).mockReturnValue(true)
    mount(<Harness current={{ type: 'aup-reader', file: '/a.md' }} />)
    click(container.querySelector('[data-testid="toggle"]'))
    click(container.querySelector('button[data-row]')) // pick the first offered projection
    expect(setPaneContent).toHaveBeenCalledWith('slot1', { type: 'editor-pane', file: '/a.md' })
    expect(state()).toBe('idle') // an accepted swap closes the picker
  })

  it('a non-file pane swaps to a bare { type } — no document to carry', () => {
    vi.mocked(setPaneContent).mockReturnValue(true)
    mount(<Harness current={{ type: 'terminal' }} />)
    click(container.querySelector('[data-testid="toggle"]'))
    click(container.querySelector('button[data-row]'))
    expect(setPaneContent).toHaveBeenCalledWith('slot1', { type: 'editor-pane' })
  })

  it('a REFUSED swap (seam returns false) keeps the picker OPEN — the fixity-guard enabler', () => {
    vi.mocked(setPaneContent).mockReturnValue(false)
    mount(<Harness current={{ type: 'aup-reader', file: '/a.md' }} />)
    click(container.querySelector('[data-testid="toggle"]'))
    click(container.querySelector('button[data-row]'))
    expect(state()).toBe('swapping') // a refusal must NOT be mistaken for a completed swap
  })
})
