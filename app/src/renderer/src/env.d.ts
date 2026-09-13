/// <reference types="vite/client" />
import type { MainApi } from '../../shared/daemon-api'

declare global {
  interface Window {
    /**
     * The preload bridge: the MAIN-process capability surface, exposed to the renderer.
     *
     * Named `main` for what it IS — the other side of the Electron process split — NOT `host`.
     * `host` is already the projection-facing contract (`MountHost`, the `host` a projection is
     * mounted with), and the two overlap in surface names (`files`, `workspace`, `terminal`, ...).
     * One is the app's private IPC channel; the other is the published projection API.
     */
    main: MainApi
  }
}

export {}
