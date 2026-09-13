import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promptLaunch } from '../src/main/terminal-prompts/launch'
import type { TerminalPromptPreset } from '@arsumbris/au-host-sdk'
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
function fixture(shell: string, preset: TerminalPromptPreset) {
  const root = mkdtempSync(join(tmpdir(), 'au-prompt-test-'))
  cleanups.push(() => rmSync(root, {recursive:true, force:true}))
  const rc = shell.endsWith('zsh') ? '.zshrc' : '.bashrc'
  writeFileSync(join(root,rc),'export AU_TEST_CONFIG=preserved\nalias test_alias="echo alias-preserved"\n')
  const launch = promptLaunch(shell,preset,{...process.env,HOME:root,ZDOTDIR:root})
  cleanups.push(launch.dispose)
  return {root,launch}
}
describe('private prompt startup', () => {
  for (const shell of ['/bin/zsh','/bin/bash']) {
    for (const preset of ['raw','minimal','compact-git','clean','context'] as const) {
      it(`${shell}: ${preset} preserves config and renders`, () => {
        const {root,launch}=fixture(shell,preset)
        const zsh=shell.endsWith('zsh')
        const cmd=zsh
          ? 'false; _au_prompt_capture; _au_prompt_render; print -r -- "$AU_TEST_CONFIG"; alias test_alias; print -P -- "$PROMPT"'
          : 'false; _au_prompt_capture; _au_prompt_render; printf "%s\\n" "$AU_TEST_CONFIG"; alias test_alias; printf "%s\\n" "$PS1" "$_au_prompt_context"'
        const output=execFileSync(shell,[...launch.args,'-c',cmd],{env:launch.env,cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']})
        expect(output).toContain('preserved')
        expect(output).toContain('alias-preserved')
        expect(output).not.toContain('command not found')
        if(preset==='raw') expect(output).toContain(zsh?'$':'\\$')
        else expect(output).toContain('❯')
        if(preset==='context') expect(output).toContain('exit 1')
      })
    }
  }
  it('inherit leaves launch args and environment untouched',()=>{
    const env={SHELL:'/bin/zsh',ZDOTDIR:'/custom',EXAMPLE:'kept'}
    const launch=promptLaunch('/bin/zsh','inherit',env)
    expect(launch.args).toEqual([])
    expect(launch.env).toEqual(env)
  })
  it('unsupported shells retain their own configuration',()=>{
    expect(promptLaunch('/bin/fish','clean',{}).args).toEqual([])
  })
})
