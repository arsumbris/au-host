/** Pre-graph discovery/create DTOs reuse the SDK-generated authoring vocabulary. */
import type {WorkspaceTemplate} from './generated'
export type {WorkspaceTemplatePreview, WorkspaceTemplate, WorkspaceTemplateManifest} from './generated'
export interface LocatedWorkspaceTemplate extends WorkspaceTemplate {
  source: string
  packages: string[]
  members: {name: string; role: 'edit' | 'discover'}[]
}
export interface WorkspaceTemplateCatalog {
  templates: LocatedWorkspaceTemplate[]
  sources: {name: string; path: string; description?: string}[]
  warnings: string[]
}
export interface MaterializeWorkspaceRequest {
  template?: {source: string; path: string}
  parent: string
  name: string
  extras: {name: string; role: 'edit' | 'discover'}[]
}
