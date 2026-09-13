import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export interface ProcessIdentity { pid: number; parent: number; started: string }

/** Only process identities/parentage, never command lines, environment, or provider transcripts. */
export async function processSnapshot(): Promise<ProcessIdentity[]> {
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
    const records = JSON.parse(stdout)
    return (Array.isArray(records) ? records : [records]).map(row => ({ pid: Number(row.ProcessId), parent: Number(row.ParentProcessId), started: String(row.CreationDate) }))
  }
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,lstart='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim().split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), started: match[3]! }] : []
  })
}

/** Capture the owned process tree BEFORE ending its PTY; reparenting after exit loses ancestry. */
export function terminalDescendants(snapshot: ProcessIdentity[], roots: number[]): ProcessIdentity[] {
  const owned = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const process of snapshot) if (!owned.has(process.pid) && owned.has(process.parent)) {
      owned.add(process.pid); changed = true
    }
  }
  return snapshot.filter(process => owned.has(process.pid))
}

/** Wait for captured owners to exit; PID reuse is not ownership. Never kill guessed descendants. */
export async function drainTerminalProcesses(
  roots: number[], stop: () => void,
  snapshot: () => Promise<ProcessIdentity[]> = processSnapshot,
  timeoutMs = 8000,
): Promise<boolean> {
  if (!roots.length) { stop(); return true }
  const captured = terminalDescendants(await snapshot(), roots)
  stop()
  return waitForTerminalProcesses(captured, snapshot, timeoutMs)
}

export async function waitForTerminalProcesses(captured: ProcessIdentity[], snapshot = processSnapshot, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const current = await snapshot()
    if (!captured.some(owner => current.some(process => process.pid === owner.pid && process.started === owner.started))) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
