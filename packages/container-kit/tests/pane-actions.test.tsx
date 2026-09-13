// The shared pane-action cluster. A container includes only the actions its slot allows.
// Verify action handlers and fixed-state presentation through the shared component.

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaneActions } from '../src/PaneActions'

const html = (actions: Parameters<typeof PaneActions>[0]['actions']): string =>
  renderToStaticMarkup(<PaneActions actions={actions} />)

describe('PaneActions — glyphs', () => {
  it('renders the drag grip for a fluid slot', () => {
    const out = html([{ kind: 'grip' }])
    expect(out).toContain('⠿')
    expect(out).toContain('title="Drag this pane"')
  })

  it('renders the LOCK (not the grip) for a fixed slot — the two-state', () => {
    const out = html([{ kind: 'grip', fixed: true }])
    expect(out).toContain('⚲')
    expect(out).not.toContain('⠿')
    expect(out).toContain('cannot be moved out') // the fixed title
  })

  it('renders swap and close with their glyphs and titles', () => {
    expect(html([{ kind: 'swap' }])).toContain('⇄')
    expect(html([{ kind: 'swap' }])).toContain('title="Swap this pane"')
    expect(html([{ kind: 'close' }])).toContain('✕')
    expect(html([{ kind: 'close' }])).toContain('title="Close pane"')
  })

  it('honours a per-action title override (containers name their unit differently)', () => {
    expect(html([{ kind: 'close', title: 'Remove this region' }])).toContain('title="Remove this region"')
  })
})

describe('PaneActions — gating by inclusion', () => {
  it('renders ONLY the actions given — an omitted action does not appear', () => {
    // A container hides swap/close on a fixed slot by NOT including them; the cluster must not
    // conjure them. This is the offer half of "a fixed pane is not swappable".
    const out = html([{ kind: 'grip', fixed: true }])
    expect(out).not.toContain('⇄') // no swap
    expect(out).not.toContain('✕') // no close
  })

  it('renders several actions together, in order', () => {
    const out = html([{ kind: 'grip' }, { kind: 'swap' }, { kind: 'close' }])
    expect(out.indexOf('⠿')).toBeLessThan(out.indexOf('⇄'))
    expect(out.indexOf('⇄')).toBeLessThan(out.indexOf('✕'))
  })
})
