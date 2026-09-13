import {expect,it,vi} from 'vitest'
vi.mock('node:child_process',()=>({spawnSync:()=>({status:0,stdout:'/fixture/login/bin'})}))
vi.mock('node:fs',()=>({accessSync:(p:string)=>{if(!['/fixture/login/bin/login-agent','/opt/homebrew/bin/brew-agent'].includes(p))throw Error('absent')},statSync:()=>({isFile:()=>true}),constants:{X_OK:1}}))
import {resolveAgentBinary} from '../src/main/tool-paths'
it('finds a login-shell executable with a minimal GUI PATH',()=>{
 vi.stubEnv('PATH','/usr/bin:/bin');vi.stubEnv('SHELL','/bin/zsh')
 expect(resolveAgentBinary('login-agent')).toBe('/fixture/login/bin/login-agent')
 vi.unstubAllEnvs()
})
it('finds a Homebrew executable outside both process and login-shell PATH',()=>{
 vi.stubEnv('PATH','/usr/bin:/bin')
 expect(resolveAgentBinary('brew-agent')).toBe('/opt/homebrew/bin/brew-agent')
 vi.unstubAllEnvs()
})
