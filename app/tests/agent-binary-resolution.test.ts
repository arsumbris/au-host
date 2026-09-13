import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveAgentBinary} from '../src/main/tool-paths'
let dir:string
afterEach(()=>{vi.unstubAllEnvs();if(dir)rmSync(dir,{recursive:true,force:true})})
it('returns an absolute executable path while preserving PATH order',()=>{
 dir=mkdtempSync(join(tmpdir(),'au-binary-test-'));const executable=join(dir,'test-agent');writeFileSync(executable,'#!/bin/sh\n');chmodSync(executable,0o700);vi.stubEnv('PATH',dir);expect(resolveAgentBinary('test-agent')).toBe(executable)
})
it('does not resolve a non-executable PATH entry',()=>{
 dir=mkdtempSync(join(tmpdir(),'au-binary-test-'));writeFileSync(join(dir,'unlaunchable-agent'),'text');vi.stubEnv('PATH',dir);expect(resolveAgentBinary('unlaunchable-agent')).toBeUndefined()
})
