import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { terminalLaunch } from '../src/main/terminal-launch'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

for (const shell of ['/bin/zsh', '/bin/bash']) {
  it(`${shell}: delayed interactive initialization delivers large quoted commands without input or echo`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'au-startup-test-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const rc = shell.endsWith('zsh') ? '.zshrc' : '.bashrc'
    writeFileSync(join(root, rc), 'echo INITIALIZING\nsleep 0.2\nexport AU_STARTUP_TEST=ready\n')
    const payload = 'quoted \' " $() ` \\ Unicode λ\n'.repeat(10000)
    const result = join(root, 'result')
    const command = `printf '%s' ${quote(payload)} > ${quote(result)}\nprintf 'CONFIG=%s\\n' "$AU_STARTUP_TEST"\nexit 23`
    const startup = terminalLaunch(shell, 'clean', command, { ...process.env, HOME: root, ZDOTDIR: root })
    cleanups.push(startup.dispose)
    let output = ''
    const proc = pty.spawn(shell, startup.args, { cwd: root, env: startup.env as Record<string, string>, cols: 80, rows: 24 })
    cleanups.push(() => { try { proc.kill() } catch {} })
    proc.onData(data => { output += data })
    let returned = false
    proc.onData(() => {
      if (!returned && output.includes('CONFIG=ready')) {
        returned = true
        proc.write("printf 'SHELL_%s\\n' READY; pwd; exit 7\r")
      }
    })
    const code = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PTY startup timed out')), 8000)
      proc.onExit(event => { clearTimeout(timer); resolve(event.exitCode) })
    })
    expect(code).toBe(7)
    expect(output).toContain('SHELL_READY')
    expect(output).toContain(root)
    expect(output.match(/INITIALIZING/g)).toHaveLength(1)
    expect(readFileSync(result, 'utf8')).toBe(payload)
    expect(output).toContain('CONFIG=ready')
    expect(output).not.toContain('quoted')
    expect(startup.args.join(' ').length).toBeLessThan(1024)
    const initDirectory = startup.env.AU_PROMPT_DIRECTORY ?? startup.args[1]
    expect(existsSync(initDirectory!)).toBe(true)
    startup.dispose()
    expect(existsSync(initDirectory!)).toBe(false)
  }, 10000)
}

it('refuses an unsupported command shell without falling back to terminal typing', () => {
  expect(() => terminalLaunch('/custom/unknown-shell', 'inherit', 'command')).toThrow('not supported')
})

it('delivers Ctrl-C to the running command and returns to a usable shell', async () => {
  const script = `process.on('SIGINT', () => { console.log('INTERRUPTED'); process.exit(0) }); console.log('READY'); setInterval(() => {}, 1000)`
  const startup = terminalLaunch('/bin/zsh', 'inherit', `${quote(process.execPath)} -e ${quote(script)}`)
  cleanups.push(startup.dispose)
  const proc = pty.spawn('/bin/zsh', startup.args, { env: startup.env as Record<string, string>, cols: 80, rows: 24 })
  cleanups.push(() => { try { proc.kill() } catch {} })
  let output = ''
  let interrupted = false
  proc.onData(data => {
    output += data
    if (!interrupted && output.includes('READY')) { interrupted = true; proc.write('\x03') }
  })
  let returned = false
  proc.onData(() => {
    if (!returned && output.includes('INTERRUPTED')) { returned = true; proc.write("printf 'AFTER_%s\\n' INTERRUPT; exit\r") }
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Interrupted command did not exit')), 8000)
    proc.onExit(() => { clearTimeout(timer); resolve() })
  })
  expect(output).toContain('INTERRUPTED')
  expect(output).toContain('AFTER_INTERRUPT')
}, 10000)
