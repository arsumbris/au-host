// `@arsumbris/au-host-launcher` — the contained launcher: the app's pre-composition surface (pick a
// workspace, set it up, start the engine) behind a `LauncherHost`
// seam the app wires to `window.main`. Single process — the app mounts the composition in place once
// the launcher signals `onEnter`. Uses plain React + CSS, never the shared `<au-*>` component set.



export { Launcher } from './Launcher'
export type { LauncherHost } from './launcher-host'
export type { GateSelection } from './gate'
export { gateRoot } from './gate'

// The enter transition — the launcher dissolves into the host. App-level, since it cross-fades the
// launcher OUT and the mounted host IN across the single-process `entered` flip.
export { Dissolve } from './design/Dissolve/Dissolve'
export { useDissolveEnter, type DissolvePhase } from './design/Dissolve/useDissolveEnter'

// The boot indicator — the host's own boot curtain reuses it, so the launcher's BootProgress fades
// straight into the host's, one continuous loading indicator across the whole cold start.
export { BootProgress, type BootState } from './design/BootProgress/BootProgress'
