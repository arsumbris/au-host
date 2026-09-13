import { describe, expect, it } from 'vitest'
import { chooseOpeningPlan, type OpeningChoices } from '../src/renderer/src/projections/opening-journey'
import { CHOOSER_BACK, type Choice, type ChooserStep } from '@arsumbris/au-component-catalog/chooser-presentation'

const input: OpeningChoices = {
  name: 'notes.md',
  destinations: [{ id: '__aup_open_into_pane__', label: 'Choose a pane' }, { id: 'replace:editor', label: 'Open in Editor' }],
  viewers: { options: [{ id: 'reader', label: 'Reader' }, { id: 'editor', label: 'Editor' }] },
  panes: [{ id: 'empty', label: 'Empty', occupied: false }, { id: 'busy', label: 'Editor', occupied: true }],
  layouts: { options: [{ id: 'tabs', label: 'Tabs' }, { id: 'split', label: 'Split' }] },
}
function choices(values: Choice[]) {
  const requests: ChooserStep[] = []
  return { requests, choose: async (request: ChooserStep) => { requests.push(request); if (!values.length) throw Error('Unexpected prompt'); return values.shift()! } }
}
describe('opening journey before placement', () => {
  it('Back revisits the previous visible step and discards the abandoned destination', async () => {
    const run = choices(['__aup_open_into_pane__', 'reader', 'busy', CHOOSER_BACK, 'empty'])
    expect(await chooseOpeningPlan(input, run.choose)).toEqual({ destination: '__aup_open_into_pane__', viewer: 'reader', pane: 'empty' })
    expect(run.requests.at(-1)?.title).toContain('Where should')
  })
  it('Back skips configured viewer choices and returns to destinations', async () => {
    const run = choices(['__aup_open_into_pane__', CHOOSER_BACK, 'replace:editor'])
    expect(await chooseOpeningPlan({ ...input, viewers: { chosen: 'editor', options: [] } }, run.choose)).toEqual({ destination: 'replace:editor' })
    expect(run.requests).toHaveLength(3)
  })
  it('cancel at the layout stage produces no placement plan', async () => {
    const run = choices(['__aup_open_into_pane__', 'editor', 'busy', null])
    expect(await chooseOpeningPlan(input, run.choose)).toBeNull()
  })
  it('preserves configured layouts for occupied targets', async () => {
    const run = choices(['__aup_open_into_pane__', 'reader', 'busy'])
    expect(await chooseOpeningPlan({ ...input, layouts: { chosen: 'tabs', options: [] } }, run.choose)).toEqual({ destination: '__aup_open_into_pane__', viewer: 'reader', pane: 'busy', kind: 'tabs' })
  })
})
