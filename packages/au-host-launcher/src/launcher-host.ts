// The LAUNCHER HOST seam: the slice of the app's capability surface the launcher needs.
//
// The launcher is a self-contained package: it owns the UI + all the pick/setup/daemon-start logic,
// but it never names Electron IPC (`window.main`) or reaches into `app/src`. Instead it declares this
// interface, and the APP passes `window.main` (its `MainApi`, a structural superset) as the host. Same
// spirit as `MountHost` for projections — the app owns the transport, the package owns the behaviour.
//
// Every method mirrors the corresponding `MainApi` member EXACTLY, so `window.main` satisfies this
// structurally. DTOs come from the app-owned tiers a package may import (`au-host-app`, `au-host-sdk`).

import type {
  ActionResult,
  ClosureResult,
  CreateWorkspaceResult,
  DaemonConfig,
  DaemonStatus,
  FoundDep,
  GateInspection,
  McpStatus,
  ToolPathsInfo,
  ToolPathsPatch,
  TouchWorkspace,
} from '@arsumbris/au-host-app'
import type { RecentWorkspace, WorkspaceTemplateCatalog, MaterializeWorkspaceRequest } from '@arsumbris/au-host-sdk'

export interface LauncherHost {
  app: {
    /** The workspace entry this instance was launched to open (`AU_ENTRY`), or null for a plain launch. */
    initialEntry(): Promise<string | null>
  }
  daemon: {
    status(config: DaemonConfig): Promise<DaemonStatus>
    start(config: DaemonConfig): Promise<ActionResult>
    stop(config: DaemonConfig): Promise<ActionResult>
    onLog(listener: (line: string) => void): () => void
    /** The owned daemon child exited; `entryPath` is the entry it was serving (null if unknown). */
    onExit(listener: (code: number | null, entryPath: string | null) => void): () => void
  }
  dialog: {
    /** Native open dialog for the workspace FOLDER (a folder-repo entry). Null if cancelled. */
    select(): Promise<string | null>
    /** Generic native picker for a file or a directory (setup flows). Null if cancelled. */
    pickPath(kind: 'file' | 'directory'): Promise<string | null>
  }
  gate: {
    workspaceTemplates(): Promise<WorkspaceTemplateCatalog>
    materializeWorkspace(request: MaterializeWorkspaceRequest): Promise<CreateWorkspaceResult>
    /** Validate a selection with RAW fs (daemon-free); a not-yet-repo comes back as `notARepo`. */
    inspect(target: string): Promise<GateInspection>
    /** Discover the full setup closure from the entry-point bundles, given what's located so far. */
    discoverClosure(located: Record<string, string>): Promise<ClosureResult>
    /** Scan a folder for repos matching any of `names`. */
    scanFor(folder: string, names: string[]): Promise<FoundDep[]>
    /** The entry's declared members NOT located in the device registry (the first-run detector). */
    missingLocations(entry: string): Promise<string[]>
    /** Register located members into the device `repos.yaml`. */
    locateMembers(entries: FoundDep[]): Promise<{ ok: boolean; error?: string }>
    /** Turn a plain directory into a folder-repo entry (the not-a-repo scaffold offer). */
    scaffoldEntry(dir: string, name?: string): Promise<CreateWorkspaceResult>
    /** Create a workspace in `dir` named `name` with the located deps. */
    createWorkspace(dir: string, name: string, deps: FoundDep[]): Promise<CreateWorkspaceResult>
  }
  mcp: {
    status(workspace: string): Promise<McpStatus>
    start(workspace: string): Promise<ActionResult>
    stop(workspace: string): Promise<ActionResult>
    toolPaths(): Promise<ToolPathsInfo>
    saveToolPaths(patch: ToolPathsPatch): Promise<void>
    pathExists(path: string): Promise<boolean>
    openPathsFile(): Promise<void>
    onLog(listener: (line: string) => void): () => void
    onExit(listener: (code: number | null) => void): () => void
  }
  recents: {
    listWorkspaces(): Promise<RecentWorkspace[]>
    touchWorkspace(ws: TouchWorkspace): Promise<void>
  }
}
