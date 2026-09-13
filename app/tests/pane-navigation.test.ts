// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@arsumbris/container-core',()=>({activatePane:vi.fn(),closePane:vi.fn()}))
vi.mock('../src/renderer/src/projections/chooser-surface',()=>({getChooserSurface:vi.fn()}))
vi.mock('../src/renderer/src/projections/platform',()=>({isMacRenderer:()=>true}))
vi.mock('../src/renderer/src/projections/open-surfaces',()=>({getOpenSurfacesIndex:()=>({list:()=>[]})}))
import { keyboardContext, focusPane } from '../src/renderer/src/projections/pane-navigation'
beforeEach(()=>document.body.replaceChildren())
function pane(id:string){const el=document.createElement('div');el.dataset.paneId=id;el.getBoundingClientRect=()=>new DOMRect(0,0,400,300);document.body.append(el);return el}
it('retains the clicked pane when plain content leaves DOM focus on the body',()=>{
 const el=pane('arbitrary-reader'),text=document.createElement('p');el.append(text)
 const event=new Event('pointerdown',{bubbles:true});let context:ReturnType<typeof keyboardContext>|undefined
 text.addEventListener('pointerdown',e=>{context=keyboardContext(e)})
 text.dispatchEvent(event);expect(context?.pane).toBe('arbitrary-reader')
 expect(keyboardContext().pane).toBe('arbitrary-reader')
 el.remove();expect(keyboardContext().pane).toBeUndefined()
})
it('focuses the pane root when the pointer target itself cannot take focus',()=>{
 const el=pane('custom-pane'),text=document.createElement('p');el.append(text)
 text.addEventListener('pointerdown',keyboardContext);text.dispatchEvent(new Event('pointerdown',{bubbles:true}))
 focusPane('custom-pane');expect(document.activeElement).toBe(el)
})
it('skips hidden controls and falls back when a candidate refuses focus',()=>{
 const el=pane('unfamiliar-settings'),hidden=document.createElement('button'),refusing=document.createElement('button')
 hidden.hidden=true;hidden.getClientRects=()=>[new DOMRect(0,0,20,20)] as unknown as DOMRectList
 refusing.getClientRects=()=>[new DOMRect(0,0,20,20)] as unknown as DOMRectList
 refusing.focus=vi.fn();el.append(hidden,refusing)
 focusPane('unfamiliar-settings')
 expect(refusing.focus).toHaveBeenCalled();expect(document.activeElement).toBe(el)
})
