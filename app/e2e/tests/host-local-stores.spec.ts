// Behaviour: the host's local stores are per-launch-isolated, a workspace has ONE live instance, and a store
// never overwrites a file it could not read (spec: host local stores).
//
// 1. A draft one launch leaves behind never reaches another launch: launch A wraps a pane (an unsaved layout
//    change → a draft in A's relocated store), closes; launch B (its own relocated dir) opens the pristine
//    fixture. The draft demonstrably EXISTS in A's dir, so B's clean load is isolation, not a missing write.
// 2. A second launch on a LIVE workspace does not open it: it focuses the holder and exits, while the holder
//    keeps running.
// 3. The renderer's claim gate: a second instance that picks a live workspace in its launcher is refused and
//    says why, and opens nothing.
// 4. A stale claim socket (its process gone) does not block a launch.
// 5. An existing drafts file this process cannot read is moved aside, never overwritten by the next flush.
//
// Bespoke launches (the standard fixture is single-launch), like view-state-restore.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { test, expect } from '../fixtures/app'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { socketFileName } from '@arsumbris/au-engine-sdk'
import { AU_BINARY, EVENT_CATEGORIES, MAIN_ENTRY } from '../support/paths'
import { daemonStatus, stopDaemon } from '../support/daemon'
import { seedComposition, shortTempDir } from '../support/recents'

const COMPOSITION = 'bento-editor'

async function launch(vault: string, hostDir: string): Promise<{ app: ElectronApplication; page: Page; profile: string }> {
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-stores-'))
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    env: { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_ENTRY: vault, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1' } as Record<string, string>,
  })
  const page = await app.firstWindow()
  const setup = page.getByText('Engine and agent tools', { exact: true })
  await setup.or(page.locator('[data-pane-id]').first()).first().waitFor({ timeout: 60_000 })
  if (await setup.isVisible()) {
    await setup.click()
    await page.getByLabel('Engine executable · required to open').fill(AU_BINARY)
    await page.getByRole('button', { name: 'Start and open workspace →', exact: true }).click()
  }
  await page.waitForSelector('[data-pane-id]', { timeout: 60_000 })
  await expect(page.locator('.au-dissolve')).toHaveAttribute('data-phase', 'done')
  return { app, page, profile }
}

/** A workspace's key in a relocated au-host dir, as main derives it (device-paths.ts `workspaceKey`). */
const workspaceKey = (vault: string): string => socketFileName(realpathSync(vault)).replace(/\.sock$/, '')

/** Wrap the first pane in tabs: an unsaved layout change, so a draft is written. */
async function makeADraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pane actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Wrap in a container' }).click()
  await page.getByRole('menuitem', { name: /^Tabs( [a-z])?$/ }).click()
  await expect(page.locator('[data-container-kind="tabs"]').first()).toBeVisible()
  await page.waitForTimeout(1000) // the renderer debounces the draft to main (400ms) before quit flushes it
}

/** Every drafts file in a relocated au-host dir, parsed. */
function draftsIn(hostDir: string): Record<string, unknown>[] {
  const dir = join(hostDir, 'data', 'composition-drafts')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

test('a draft one launch leaves never reaches another launch', async ({ vault }) => {
  const hostA = shortTempDir('auh-')
  const hostB = shortTempDir('auh-')
  try {
    seedComposition(COMPOSITION, hostA, vault)
    seedComposition(COMPOSITION, hostB, vault)
    const a = await launch(vault, hostA)
    try {
      await makeADraft(a.page)
    } finally {
      await a.app.close() // flush-on-quit persists the unsaved layout as a draft
      rmSync(a.profile, { recursive: true, force: true })
    }
    expect(draftsIn(hostA).some((d) => Object.keys(d).length > 0), 'launch A persisted its unsaved layout as a draft').toBe(true)

    const b = await launch(vault, hostB)
    try {
      await expect(b.page.locator('.cm-content').first()).toContainText('Sample content')
      await expect(b.page.locator('[data-container-kind="tabs"]'), 'launch B opened the pristine fixture').toHaveCount(0)
    } finally {
      await b.app.close()
      rmSync(b.profile, { recursive: true, force: true })
    }
  } finally {
    rmSync(hostA, { recursive: true, force: true })
    rmSync(hostB, { recursive: true, force: true })
  }
})

test('opening a workspace whose engine is already running claims it, so its drafts persist', async ({ vault }) => {
  // The setup form's "Open workspace →" (an engine already serving the entry) enters WITHOUT starting one.
  // Entering must still claim the workspace: an unclaimed instance leaves its stores unbound, and every
  // draft and view-state write is silently dropped.
  const daemon = spawn(AU_BINARY, ['daemon', 'start', vault], { stdio: 'ignore' })
  const hostDir = shortTempDir('auh-')
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-stores-'))
  let app: ElectronApplication | undefined
  try {
    await expect.poll(() => daemonStatus(vault), { timeout: 60_000 }).toContain('ready=true')
    seedComposition(COMPOSITION, hostDir, vault)
    app = await electron.launch({
      args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
      env: { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_ENTRY: vault, AU_HOST_EVENTS: EVENT_CATEGORIES, AU_E2E_OFFSCREEN: '1' } as Record<string, string>,
    })
    const page = await app.firstWindow()
    await page.getByText('Engine and agent tools', { exact: true }).click()
    await page.getByLabel('Engine executable · required to open').fill(AU_BINARY)
    await page.getByRole('button', { name: 'Open workspace →', exact: true }).click()
    await page.waitForSelector('[data-pane-id]', { timeout: 60_000 })
    await makeADraft(page)
  } finally {
    await app?.close() // flush-on-quit writes the draft, when the stores are bound
    daemon.kill()
    stopDaemon(vault)
    rmSync(profile, { recursive: true, force: true })
  }
  try {
    expect(draftsIn(hostDir).some((d) => Object.keys(d).length > 0), 'the unsaved layout was written as a draft').toBe(true)
  } finally {
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('a second launch on a live workspace focuses the holder and exits', async ({ vault }) => {
  const hostDir = shortTempDir('auh-')
  seedComposition(COMPOSITION, hostDir, vault)
  const holder = await launch(vault, hostDir)
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-stores-'))
  try {
    const electronBin = require('electron') as unknown as string
    const second = spawn(electronBin, [MAIN_ENTRY, `--user-data-dir=${profile}`], {
      env: { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_ENTRY: vault, AU_E2E_OFFSCREEN: '1' },
      stdio: 'ignore',
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill()
        reject(new Error('the second launch did not exit within 20s'))
      }, 20_000)
      second.on('exit', (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    expect(code, 'the second launch exits cleanly').toBe(0)
    // The holder is untouched: still serving its composition.
    await expect(holder.page.locator('.cm-content').first()).toContainText('Sample content')
  } finally {
    await holder.app.close()
    rmSync(holder.profile, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test("the launcher's claim gate refuses a live workspace and says why", async ({ vault }) => {
  const hostDir = shortTempDir('auh-')
  const profile = mkdtempSync(join(tmpdir(), 'au-host-e2e-stores-'))
  try {
    seedComposition(COMPOSITION, hostDir, vault)
    const holder = await launch(vault, hostDir)
    try {
      // A plain launch (no AU_ENTRY): the launcher pre-fills the most recent workspace, the one held.
      const env = { ...process.env, AU_HOST_DEVICE_DIR: hostDir, AU_E2E_OFFSCREEN: '1' } as Record<string, string>
      delete env.AU_ENTRY
      const second = await electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${profile}`], env })
      try {
        const page = await second.firstWindow()
        await page.getByRole('button', { name: 'Launch', exact: true }).click()
        await expect(page.getByText('this workspace is already open in another window')).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('[data-pane-id]'), 'the refused instance opened nothing').toHaveCount(0)
      } finally {
        await second.close()
      }
      await expect(holder.page.locator('.cm-content').first()).toContainText('Sample content')
    } finally {
      await holder.app.close()
      rmSync(holder.profile, { recursive: true, force: true })
    }
  } finally {
    rmSync(profile, { recursive: true, force: true })
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('a stale claim socket does not block a launch', async ({ vault }) => {
  const hostDir = shortTempDir('auh-')
  try {
    seedComposition(COMPOSITION, hostDir, vault)
    // What a crashed instance leaves behind: the socket file, with nothing listening on it.
    const socket = join(hostDir, 'run', `${workspaceKey(vault)}.instance.sock`)
    mkdirSync(join(hostDir, 'run'), { recursive: true })
    writeFileSync(socket, '')
    const app = await launch(vault, hostDir)
    try {
      await expect(app.page.locator('.cm-content').first()).toContainText('Sample content')
    } finally {
      await app.app.close()
      rmSync(app.profile, { recursive: true, force: true })
    }
  } finally {
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('a drafts file this process cannot read is moved aside, never overwritten', async ({ vault }) => {
  const hostDir = shortTempDir('auh-')
  const drafts = join(hostDir, 'data', 'composition-drafts')
  try {
    seedComposition(COMPOSITION, hostDir, vault)
    mkdirSync(drafts, { recursive: true })
    const file = join(drafts, `${workspaceKey(vault)}.json`)
    writeFileSync(file, JSON.stringify({ precious: { t: 1 } }))
    chmodSync(file, 0o000) // exists, but unreadable to this process
    const app = await launch(vault, hostDir)
    try {
      await makeADraft(app.page) // a real draft write: the flush that would have overwritten it
    } finally {
      await app.app.close()
      rmSync(app.profile, { recursive: true, force: true })
    }
    const aside = readdirSync(drafts).filter((f) => f.includes('.corrupt-'))
    expect(aside, 'the unreadable file was moved aside').toHaveLength(1)
    chmodSync(join(drafts, aside[0]), 0o600)
    expect(JSON.parse(readFileSync(join(drafts, aside[0]), 'utf8')), 'its bytes survive intact').toEqual({ precious: { t: 1 } })
  } finally {
    rmSync(hostDir, { recursive: true, force: true })
  }
})
