import { useState } from 'react'
import { DragOverlay } from '@arsumbris/container-kit'
import { Launcher, Dissolve, useDissolveEnter } from '@arsumbris/au-host-launcher'

import { ProjectionHost } from './projections/ProjectionHost'
import { loadConfig, saveConfig } from './config'
import type { DaemonConfig } from '../../shared/daemon-api'

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<DaemonConfig>(loadConfig)
  // Three-step, single-process boot:
  //   launcher → (daemon ready) mount the host HIDDEN behind the launcher → (composition painted)
  //   dissolve the launcher away, revealing the finished workspace.
  // `mountHost` flips on daemon-ready; `entered` flips once the dissolve completes and only the host
  // remains. The launcher holds its own loader (over the mist) the WHOLE time the host is booting, so
  // there is never a separate bare loader on black — the reveal is the ready composition.
  const [mountHost, setMountHost] = useState(false)
  const [entered, setEntered] = useState(false)
  const dissolve = useDissolveEnter()

  const updateConfig = (patch: Partial<DaemonConfig>): void => {
    setConfig((prev) => {
      const next = { ...prev, ...patch }
      saveConfig(next)
      return next
    })
  }

  // The host paints (its boot curtain would lift) → NOW dissolve the launcher away.
  const onHostReady = (): void => {
    void dissolve.enter().then(() => setEntered(true))
  }

  const hostNode = (
    <div className="app">
      <ProjectionHost config={config} onConfigChange={updateConfig} onReady={onHostReady} />
      {/* One host-owned drag overlay per window; reads the window-shared container-core store so a drag
          from any container bundle surfaces here. */}
      <DragOverlay />
    </div>
  )

  // The launcher (its own package) picks + starts the engine, then signals `onEnter` (daemon ready).
  // The app owns the transport, passing `window.main` as the launcher's `LauncherHost`.
  const launcherNode = (
    <div className="app">
      <Launcher
        host={window.main}
        config={config}
        onConfigChange={updateConfig}
        onEnter={() => setMountHost(true)}
        defaultEntry={config.entryPath}
      />
    </div>
  )

  // ONE stable `<Dissolve>` root across the WHOLE boot, so neither the launcher nor the host ever
  // changes tree position — and therefore neither ever remounts (a remount tore down the launcher's
  // Mist for a blank frame, and re-booted a just-painted host into its own curtain-on-black).
  //  - launcher slot: always the launcher (never remounts) until the crossfade is DONE, then nulled to
  //    reclaim its idle Mist GPU. It holds its own loader over the mist the whole time.
  //  - app slot: the host mounts ONCE when the daemon is ready (`mountHost`), boots at opacity 0 behind
  //    the launcher, and calls `onReady` when its composition is genuinely painted → the dissolve runs.
  return (
    <Dissolve
      phase={dissolve.phase}
      duration={dissolve.duration}
      launcher={entered ? null : launcherNode}
      app={mountHost ? hostNode : null}
    />
  )
}
