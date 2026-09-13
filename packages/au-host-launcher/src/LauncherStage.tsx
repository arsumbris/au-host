import type { ReactNode } from 'react'
import { LauncherAvatar } from './LauncherAvatar'
import { Mist } from './design/Mist/Mist'

/** One persistent brand/atmosphere shell across picking, setup, and boot. */
export function LauncherStage({view, title, children}: {title?: string; view: 'home' | 'setup' | 'boot'; children: ReactNode}) {
  return <div className="au-launcher-stage" data-view={view}>
    <Mist />
    <div className="au-launcher-window-drag" aria-hidden="true" />
    <div className="au-launcher-shell">
      <header className="au-launcher-identity">
        <div className="au-launcher-identity__avatar"><LauncherAvatar /></div>
        <span className="au-launcher-identity__brand">Ars Umbris</span>
        <h1>{title ?? (view === 'setup' ? 'Workspace setup' : view === 'boot' ? 'Opening workspace' : 'Your workspace')}</h1>
      </header>
      {children}
    </div>
  </div>
}
