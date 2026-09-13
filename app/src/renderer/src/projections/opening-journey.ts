import type { ChooseOption } from './host-config'
import { CHOOSER_BACK, type Choice, type ChooserStep } from '@arsumbris/au-component-catalog/chooser-presentation'

export interface OpeningPlan { destination: string; viewer?: string; pane?: string; kind?: string }
export interface OpeningChoices {
  name: string
  destinations: ChooseOption[]
  viewers: { chosen?: string; options: ChooseOption[] }
  panes: (ChooseOption & { occupied: boolean })[]
  layouts: { chosen?: string; options: ChooseOption[] }
}
type Stage = 'destination' | 'viewer' | 'pane' | 'layout'

/** Collect choices before the caller mutates any placement. Back only revisits presented steps. */
export async function chooseOpeningPlan(
  input: OpeningChoices,
  choose: (request: ChooserStep) => Promise<Choice>,
): Promise<OpeningPlan | null> {
  let stage: Stage = 'destination'
  const history: Stage[] = []
  let plan: OpeningPlan = { destination: '' }
  async function ask(title: string, options: ChooseOption[]): Promise<Choice> {
    const result = await choose({ title, options, back: history.length > 0 })
    if (result === CHOOSER_BACK) { stage = history.pop() || 'destination'; return CHOOSER_BACK }
    if (result !== null) history.push(stage)
    return result
  }
  while (true) {
    if (stage === 'destination') {
      const picked = await ask(`Open ${input.name}`, input.destinations)
      if (picked === null) return null
      if (picked === CHOOSER_BACK) continue
      plan = { destination: picked }
      if (picked.startsWith('replace:')) return plan
      stage = 'viewer'
    } else if (stage === 'viewer') {
      const picked = input.viewers.chosen ?? await ask(`View ${input.name} with`, input.viewers.options)
      if (picked === null) return null
      if (picked === CHOOSER_BACK) continue
      plan.viewer = picked
      if (plan.destination === '__aup_open_new_window__') return plan
      stage = plan.destination === '__aup_open_into_pane__' ? 'pane' : 'layout'
    } else if (stage === 'pane') {
      const picked = input.panes.length === 1 ? input.panes[0]!.id : await ask(`Where should ${input.name} open?`, input.panes)
      if (picked === null) return null
      if (picked === CHOOSER_BACK) continue
      plan.pane = picked
      if (!input.panes.find(p => p.id === picked)?.occupied) return plan
      stage = 'layout'
    } else {
      const picked = input.layouts.chosen ?? (input.layouts.options.length === 0 ? undefined : await ask(`Keep both files — choose a layout`, input.layouts.options))
      if (picked === null) return null
      if (picked === CHOOSER_BACK) continue
      plan.kind = picked
      return plan
    }
  }
}
