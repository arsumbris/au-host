// A local superset of the MountHost contract. This carries:
// - `daemon` / `mcp` — app-owned BY DESIGN: their status/config/governance DTOs are
//   app vocabulary the SDK never mediates (same substrate-vocab rule as range/selection).
// - `workspaceEdit` / `scope` — app-owned + coupled to the schema-15 folder-repo model.
// - `commitComposition` — the guarded root-composition writer.
//
// `engineReady` / `confirm` / `shell` / `windowRoot`, the FilesControl read-before-write guard,
// and `intent`/`focus`/`viewStore`/`instanceId`/`terminal`/`listContributions`/`listProjections`/
// `preview` belong to MountHost.


import type {
  ChromeContribution,
  ChooseOption,
  ChooseRequest,
  ChooserSurface,
  CloseGuard,
  CloseGuardChannel,
  ConfirmOutcome,
  ConfirmRequest,
  ConfirmSurface,
  EngineReadiness,
  FileReadResult,
  FileWriteResult,
  FillFn,
  FilesControl,
  FocusChannel,
  IntentChannel,
  IntentPayload,
  LinkResolver,
  ActionDescriptor,
  ContextMenuItem,
  ContextMenuSurface,
  MenuAnchor,
  MenuHandle,
  OpaqueConfig,
  OpenSurfaces,
  OpenContent,
  OpenSurface,
  OverlayLayer,
  OverlayLevel,
  OverlayOptions,
  OverlaySite,
  SubmenuDescriptor,
  PreviewSurface,
  Projection,
  Ref,
  SelectionChannel,
  ShellControl,
  TerminalChannel,
  TerminalSession,
  ThemeControl,
  ViewStore,
  WorkspaceMember,
} from '@arsumbris/au-host-sdk'

// Re-export contract types from au-host-sdk as a single renderer import surface.
// A projection's config is its typed instance; app-owned capabilities are defined separately here.
export type {
  OpaqueConfig,
  Projection,
  Ref,
  FilesControl,
  SelectionChannel,
  WorkspaceMember,
  FileReadResult,
  FileWriteResult,
  IntentChannel,
  IntentPayload,
  FocusChannel,
  // The CLOSE-GUARD channel: a projection registers a guard the host consults before removing its
  // node. Additive + optional on `MountHost`, so no contract bump.
  CloseGuard,
  CloseGuardChannel,
  ViewStore,
  ThemeControl,
  TerminalChannel,
  TerminalSession,
  ChromeContribution,
  PreviewSurface,
  FillFn,
  LinkResolver,
  // The OVERLAY SITE: a place to draw above the composition, for what a pane cannot contain.
  // Additive + optional on `MountHost`, so no contract bump.
  OverlaySite,
  OverlayLayer,
  OverlayOptions,
  OverlayLevel,
  // OPEN SURFACES: the host-owned live index of what is mounted and what each surface addresses.
  // Additive + optional on `MountHost`, so no contract bump.
  OpenSurfaces,
  OpenContent,
  OpenSurface,
  // The CONTEXT MENU, built over the overlay site's `dropdown` band.
  ContextMenuSurface,
  ContextMenuItem,
  ActionDescriptor,
  SubmenuDescriptor,
  MenuAnchor,
  MenuHandle,
  // Re-exported from MountHost here so the renderer imports from one place.
  ConfirmSurface,
  ConfirmRequest,
  ConfirmOutcome,
  // The CHOOSER: a menu for an ambiguous decision. Additive + optional on
  // `MountHost`, so no contract bump.
  ChooserSurface,
  ChooseRequest,
  ChooseOption,
  ShellControl,
  EngineReadiness,
}

// The APP-OWNED tier moved to `@arsumbris/au-host-app`, so the four projections that need it can
// import it instead of hand-rolling a `MountHostX extends MountHost` mirror. Re-exported here so
// the renderer keeps importing from one place.
export type {
  CompositionCommit,
  CompositionEditControl,
  KeymapsControl,
  CompositionNode,
  CompositionWire,
  DaemonControl,
  DispatchEvent,
  HostApp,
  LaunchEnv,
  McpControl,
  ScopeControl,
  ScopeWriteResult,
  WindowControl,
  WorkspaceControl,
} from '@arsumbris/au-host-app'

// STAND-IN: commit the root composition to disk NOW. `saveConfig` only
// updates the host's working buffer (layout edits are saved explicitly); a STRUCTURAL
// gesture must not leave the source file stale, so the root asks the host — which owns
// the composition path + the guarded-write hash baseline — to persist immediately.

// HostApp: MountHost plus the capabilities that are APP-OWNED BY DESIGN.
// `engineReady` / `confirm` / `shell` / `windowRoot` are inherited from MountHost
// (additive + optional). What lives on HostApp:
// - `daemon` / `mcp` — their status/governance DTOs are app vocabulary the SDK never
//   mediates (same substrate-vocab rule as range/selection), so they stay app-side deliberately.
// - `workspaceEdit` / `scope` — app-owned + schema-15 folder-repo coupled.
// - `commitComposition` — the guarded root-composition writer.
