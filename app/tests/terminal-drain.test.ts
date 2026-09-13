import { expect, it, vi } from 'vitest'
import { drainTerminalProcesses, terminalDescendants } from '../src/main/terminal-drain'
import { orderedShutdown } from '../src/main/ordered-shutdown'
const process = (pid: number, parent: number, started='original') => ({pid,parent,started})
it('captures only terminal roots and descendants, regardless of snapshot order', () => {
 expect(terminalDescendants([process(3,2),process(1,0),process(2,1),process(9,0)], [1]).map(p=>p.pid)).toEqual([3,1,2])
})
it('keeps lifecycle services until the child finishes after its shell exits', async () => {
 const events:string[]=[]
 const snapshots=[[process(1,0),process(2,1)],[process(2,0)],[]]
 const snapshot=vi.fn(async()=>{events.push('snapshot');return snapshots.shift()!})
 expect(await orderedShutdown(()=>drainTerminalProcesses([1],()=>events.push('stop-terminal'),snapshot),()=>events.push('stop-services'))).toBe(true)
 expect(events).toEqual(['snapshot','stop-terminal','snapshot','snapshot','stop-services'])
})
it('does not confuse a reused PID with the captured owner',async()=>{
 const snapshot=vi.fn().mockResolvedValueOnce([process(1,0)]).mockResolvedValue([process(1,0,'replacement')])
 expect(await drainTerminalProcesses([1],vi.fn(),snapshot)).toBe(true)
})
it('leaves services up when shutdown times out',async()=>{
 const dispose=vi.fn()
 expect(await orderedShutdown(()=>drainTerminalProcesses([1],vi.fn(),async()=>[process(1,0)],0),dispose)).toBe(false)
 expect(dispose).not.toHaveBeenCalled()
})
it('does not stop anything when ownership cannot be inspected',async()=>{
 const stop=vi.fn();const dispose=vi.fn()
 await expect(orderedShutdown(()=>drainTerminalProcesses([1],stop,async()=>{throw Error('no snapshot')}),dispose)).rejects.toThrow('no snapshot')
 expect(stop).not.toHaveBeenCalled();expect(dispose).not.toHaveBeenCalled()
})
