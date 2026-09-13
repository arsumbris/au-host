import { describe, it, expect } from 'vitest'
import { yamlFieldContext } from './yaml-field'

const at = (source: string, key: string) => yamlFieldContext(source, source.indexOf(key) + 1)
describe('current-buffer YAML field paths', () => {
  it('tracks nested mappings and sequence records from their root claim', () => {
    expect(at('type: custom-station\nconditions:\n  temperature: 0', 'temperature')?.steps).toEqual([
      { field: 'conditions', claims: ['custom-station'] }, { field: 'temperature', claims: [] },
    ])
    expect(at('type: custom-station\nitems:\n - name: probe', 'name')?.steps.map(step => step.field)).toEqual(['items', 'name'])
  })
  it('preserves explicit inline claims and qualified multiple claims', () => {
    expect(at('type: [station::custom, tagged]\nchild: {type: other, "label": value}', 'label')?.steps).toEqual([
      { field: 'child', claims: ['station::custom', 'tagged'] }, { field: 'label', claims: ['other'] },
    ])
  })
  it('does not turn values, unclaimed keys or the claim key into field links', () => {
    expect(at('type: station\ntitle: example', 'example')).toBeNull()
    expect(at('title: example', 'title')).toBeNull()
    expect(at('type: station', 'type')).toBeNull()
  })
  it('uses changed claims immediately and keeps documents separate', () => {
    expect(at('type: first\nname: x', 'name')?.steps[0]?.claims).toEqual(['first'])
    expect(at('type: second\nname: x', 'name')?.steps[0]?.claims).toEqual(['second'])
    expect(at('type: first\n---\ntype: second\nname: x', 'name')?.steps[0]?.claims).toEqual(['second'])
  })
})

describe('engine declaration resolution', () => {
  it('keeps divergent origins and honors an explicit field qualifier', async () => {
    const {resolveYamlField} = await import('./yaml-field')
    const identities = ['custom-a','custom-b'].map(name => ({name,repo:'custom',closure_id:name}))
    const engine: import('@arsumbris/au-host-sdk/engine-reads').WireReader = {
      async read(request: {read:string} & Record<string,unknown>) {
        const result = request.read === 'resolve_member' ? {resolve_member:{repo:'custom'}} : request.read === 'type_closure' ? {type_closure:[{identity:identities[0],ancestors:identities,fields:[]}]} : {type:{fields:[{name:'value',shape:request.name === 'custom-a::custom' ? 'String':'Number',shape_ast:null,required:true}]}}
        return {ready:true,version:1,result} as never
      },
    }
    const source = 'type: combined\nvalue: example'
    const found = await resolveYamlField(engine,'/custom/file.yaml',at(source,'value')!)
    expect(found.map(field=>field.origin.name)).toEqual(['custom-a','custom-b'])
    expect(found.map(field=>field.shape)).toEqual(['String','Number'])
    const qualified = 'type: combined\n"value{custom-b}": 0'
    const chosen = await resolveYamlField(engine,'/custom/file.yaml',at(qualified,'value')!)
    expect(chosen.map(field=>field.origin.name)).toEqual(['custom-b'])
  })
})
