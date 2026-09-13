// @vitest-environment happy-dom
import {describe, expect, it} from 'vitest'
import {sourceLocations, closestSourceElement} from '../../projections/aup-reader/src/source-locations'

describe('Reader source locations', () => {
  it('maps Markdown offsets past frontmatter into UTF-8 engine offsets', () => {
    const prefix = '---\ntitle: Résumé\n---\n'
    const source = prefix + '# Heading\n\nA café.'
    const node = {type:'element', position:{start:{offset:11}, end:{offset:18}}, properties:{} as Record<string,unknown>}
    sourceLocations(source, prefix.length)()({type:'root',children:[node]})
    expect(node.properties['data-source-from']).toBe(new TextEncoder().encode(prefix+'# Heading\n\n').length)
    expect(node.properties['data-source-to']).toBe(new TextEncoder().encode(source).length)
  })
  it('reveals the smallest containing rendered block', () => {
    const root=document.createElement('div')
    root.innerHTML='<section data-source-from="0" data-source-to="100"><p data-source-from="40" data-source-to="70">Target</p></section>'
    expect(closestSourceElement(root, 53)?.tagName).toBe('P')
  })
})
