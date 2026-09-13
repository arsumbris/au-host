import { displayFilePath } from '@arsumbris/au-host-sdk'
// The minimal projection: TypeScript over @arsumbris/au-host-sdk, built to dist/. It proves the whole
// contract path — the type-def + runtime-meta handshake, the entry import, mount/unmount, an engine
// read via the host, and registration through `defineProjection`.

import { helloProvenance } from './provenance'

import { defineProjection } from '@arsumbris/au-host-sdk'
import type { MountFn, ProjectionModule } from '@arsumbris/au-host-sdk'

const mount: MountFn = (container, host) => {
  const root = document.createElement('au-scroll-area')
  root.setAttribute('axis', 'y')
  root.style.height = '100%'
  root.style.overflowWrap = 'anywhere'
  root.style.fontFamily = 'var(--au-font-mono)'
  root.style.fontSize = 'var(--au-t-xs)'
  root.style.lineHeight = 'var(--au-lh-xs)'
  root.style.color = 'var(--au-ink-2)'

  const title = document.createElement('div')
  // `host.entry.path` — the folder-repo the daemon entered on.
  title.textContent = `hello from a mounted projection — entry: ${displayFilePath(host.entry.path, host.workspace.members)} (contract v${host.contractVersion})`

  const pre = document.createElement('pre')
  pre.textContent = 'reading { read: "lifecycle" } …'
  pre.style.whiteSpace = 'pre-wrap'

  const committedAt = document.createElement('time')
  committedAt.dateTime = helloProvenance.committedAt
  committedAt.textContent = helloProvenance.committedAt
  root.append(title, committedAt, pre)
  container.appendChild(root)

  let alive = true
  // `lifecycle` — the daemon's readiness probe.
  host.engine.read({ read: 'lifecycle' }).then((result) => {
    if (alive) pre.textContent = JSON.stringify(result, null, 2)
  })

  return () => {
    alive = false
    container.replaceChildren()
  }
}

/**
 * The registered module — the projection's single default export. `defineProjection` brands it as the
 * loader's registration gate (the host resolves `mount` off the branded default), and typing
 * `ProjectionModule` makes a missing / mis-shaped `mount` a COMPILE error here.

 */
export default defineProjection<ProjectionModule>({ mount })
