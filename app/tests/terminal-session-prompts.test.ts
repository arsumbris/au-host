import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import type { WebContents } from 'electron'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
import { TerminalSessions } from '../src/main/terminal'

const managers: TerminalSessions[] = []
afterEach(() => { for (const manager of managers) manager.killAll(); managers.length = 0; vi.clearAllMocks() })
function setup() {
  const listeners = new Set<(data: string) => void>()
  let exit = () => {}
  const proc = {
    onData: vi.fn((listener: (data: string) => void) => {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    }),
    onExit: vi.fn((listener: () => void) => { exit = listener; return { dispose() {} } }),
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pid: 123,
  }
  mocks.spawn.mockReturnValue(proc)
  const send = vi.fn()
  const sender = { id: 1, isDestroyed: () => false, send } as unknown as WebContents
  const manager = new TerminalSessions()
  managers.push(manager)
  return { manager, sender, proc, send, emit: (data: string) => { for (const listener of [...listeners]) listener(data) }, exit: () => exit() }
}

describe('prompt presentation preserves host PTY lifetime', () => {
  it('launches a script once without terminal input and preserves the process on reattach', () => {
    const { manager, sender, proc, emit, send } = setup()
    const command = "ENV_VALUE='two words' agent --arg 'quoted value'"
    manager.attach('comp', 'pane', 1, sender, { shell: '/bin/zsh', prompt: 'clean', command })
    expect(proc.write).not.toHaveBeenCalled()
    emit('ready> ')
    emit('output')
    const init = readFileSync(mocks.spawn.mock.calls[0][2].env.ZDOTDIR + '/.zshrc', 'utf8')
    const script = init.match(/\( source '([^']+)' \)/)![1]
    expect(readFileSync(script, 'utf8')).toBe(command + '\n')
    expect(proc.write).not.toHaveBeenCalled()
    manager.detach('comp', 'pane', 1)
    manager.attach('comp', 'pane', 2, sender, { shell: '/bin/bash', prompt: 'raw', command: 'different' })
    emit('more')
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.spawn.mock.calls[0][2].env.AU_PROMPT_PRESET).toBe('clean')
    expect(proc.write).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('terminal:data', { token: 2, data: 'ready> output' })
  })
  it('keeps the same process and buffered output when a pane moves, then reaps actual removal', () => {
    const { manager, sender, proc, emit, send } = setup()
    manager.attach('comp', 'session-pane', 1, sender, { shell: '/bin/bash', prompt: 'raw' })
    emit('session is running')
    manager.detach('comp', 'session-pane', 1)
    // Container placement is not part of the PTY identity: an atomic move retains this node.
    manager.reconcile('comp', ['other-pane', 'session-pane'])
    expect(proc.kill).not.toHaveBeenCalled()
    manager.attach('comp', 'session-pane', 2, sender, { shell: '/bin/bash', prompt: 'raw' })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('terminal:data', { token: 2, data: 'session is running' })
    manager.reconcile('comp', ['other-pane'])
    expect(proc.kill).toHaveBeenCalledTimes(1)
  })
  it('does not send startup code or a command into plain interactive terminals', () => {
    const { manager, sender, emit, proc } = setup()
    manager.attach('comp', 'pane', 1, sender, { shell: '/bin/bash', prompt: 'minimal' })
    emit('ready')
    expect(proc.write).not.toHaveBeenCalled()
    expect(mocks.spawn.mock.calls[0][1][0]).toBe('--rcfile')
  })
  it('keeps temporary startup files on detach and removes them on exit', () => {
    const { manager, sender, exit } = setup()
    manager.attach('comp', 'pane', 1, sender, { shell: '/bin/zsh', prompt: 'minimal' })
    const directory = mocks.spawn.mock.calls[0][2].env.ZDOTDIR
    manager.detach('comp', 'pane', 1)
    expect(existsSync(directory)).toBe(true)
    exit()
    expect(existsSync(directory)).toBe(false)
    manager.attach('comp', 'pane', 2, sender, { shell: '/bin/zsh', prompt: 'raw' })
    expect(mocks.spawn.mock.calls[1][2].env.AU_PROMPT_PRESET).toBe('raw')
  })
  it('cleans temporary files and reports spawn failure', () => {
    const { manager, sender, send } = setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.spawn.mockImplementation(() => { throw new Error('spawn failed') })
    try {
      manager.attach('comp', 'pane', 1, sender, { shell: '/bin/zsh', prompt: 'clean' })
      expect(existsSync(mocks.spawn.mock.calls[0][2].env.ZDOTDIR)).toBe(false)
      expect(send).toHaveBeenCalledWith('terminal:exit', { token: 1 })
    } finally { error.mockRestore() }
  })
  it.each([['/bin/zsh', 'inherit'], ['/bin/fish', 'clean']] as const)('retains inherited prompt for %s / %s', (shell, prompt) => {
    const { manager, sender } = setup()
    manager.attach('comp', 'pane', 1, sender, { shell, prompt })
    expect(mocks.spawn.mock.calls[0][1]).toEqual([])
    expect(mocks.spawn.mock.calls[0][2].env).toEqual(process.env)
  })
  it('killAll removes every private startup directory', () => {
    const { manager, sender } = setup()
    manager.attach('comp', 'one', 1, sender, { shell: '/bin/zsh', prompt: 'clean' })
    manager.attach('comp', 'two', 2, sender, { shell: '/bin/zsh', prompt: 'context' })
    const directories = mocks.spawn.mock.calls.map(call => call[2].env.ZDOTDIR)
    manager.killAll()
    for (const directory of directories) expect(existsSync(directory)).toBe(false)
  })
})
