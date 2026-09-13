// The default set's entry: the `register(api)` export the host calls.

// The set NEVER calls `customElements.define` and NEVER self-registers on import — it hands the
// host raw element classes through `api.define`, and the HOST chooses the target registry (global
// at boot; a per-set scoped registry for the gallery preview). This indirection is the whole seam
// that makes discovery / selection / swap possible.


import type { ComponentSetApi } from '@arsumbris/component-contract'
import { AuButtonElement } from './au-button'
import { AuCardElement } from './au-card'
import { AuBadgeElement } from './au-badge'
import { AuTreeElement, AuTreeItemElement } from './au-tree'
import { AuChipElement } from './au-chip'
import { AuCommandPaletteElement } from './au-command-palette'
import { AuTypedValueEditorElement } from './au-typed-value-editor'
import { AuIconElement } from './au-icon'
import { AuIconButtonElement } from './au-icon-button'
import { AuGripGlyphElement } from './au-grip-glyph'
import { AuCloseButtonElement } from './au-close-button'
import { AuViewerSwitchElement } from './au-viewer-switch'
import { AuChevronElement } from './au-chevron'
import { AuPaneFrameElement } from './au-pane-frame'
import { AuPaneHeaderElement } from './au-pane-header'
import { AuSplitterElement } from './au-splitter'
import { AuTabStripCellElement } from './au-tab-strip-cell'
import { AuTabBarElement } from './au-tab-bar'
import { AuStatusDotElement } from './au-status-dot'
import { AuInputElement } from './au-input'
import { AuNavItemElement } from './au-nav-item'
import { AuTreeRowElement } from './au-tree-row'
import { AuSectionHeaderElement } from './au-section-header'
import { AuNavGroupElement } from './au-nav-group'
import { AuWorkspaceMarkElement } from './au-workspace-mark'
import { AuWorkspaceSwitcherElement } from './au-workspace-switcher'
import { AuTagElement } from './au-tag'
import { AuPillElement } from './au-pill'
import { AuDividerElement } from './au-divider'
import { AuSpinnerElement } from './au-spinner'
import { AuScrollAreaElement } from './au-scroll-area'
import { AuOutputLogElement } from './au-output-log'
import { AuEmptyStateElement } from './au-empty-state'
import { AuCodeBlockElement } from './au-code-block'
import { AuDiffLineElement } from './au-diff-line'
import { AuListRowElement } from './au-list-row'
import {
  AuTableElement,
  AuTableHeadElement,
  AuTableBodyElement,
  AuTableRowElement,
  AuTableHeaderCellElement,
  AuTableCellElement,
} from './au-table'
import { AuFieldElement } from './au-field'
import { AuSegmentedControlElement } from './au-segmented-control'
import { AuColorPickerElement } from './au-color-picker'
import { AuCheckboxElement } from './au-checkbox'
import { AuSwitchElement } from './au-switch'
import { AuRadioGroupElement } from './au-radio-group'
import { AuTextareaElement } from './au-textarea'
import { AuNumberInputElement } from './au-number-input'
import { AuSelectElement } from './au-select'
import { AuBannerElement } from './au-banner'
import { AuAccordionElement } from './au-accordion'
import { AuAccordionItemElement } from './au-accordion-item'
import { AuTooltipElement } from './au-tooltip'
import { AuToggleChipElement } from './au-toggle-chip'
import { AuToastElement } from './au-toast'
import { AuMenuElement } from './au-menu'
import { AuMenuItemElement } from './au-menu-item'
import { AuModalElement } from './au-modal'
// Additional component implementations, registered alongside the core controls.
import { AuSwatchElement } from './au-swatch'
import { AuCodeSampleElement } from './au-code-sample'
import { AuMeterElement } from './au-meter'
import { AuSkeletonElement } from './au-skeleton'
import { AuSliderElement } from './au-slider'
import { AuBreadcrumbElement } from './au-breadcrumb'
import { AuToolbarElement, AuToolbarGroupElement, AuToolbarSpacerElement } from './au-toolbar'
import { AuDetailListElement } from './au-detail-list'
import { AuDropZoneElement } from './au-drop-zone'
import { AuPaneTargetElement } from './au-pane-target'
import { AuStepperElement } from './au-stepper'
import { AuPaginationElement } from './au-pagination'
import { AuComboboxElement } from './au-combobox'
import { AuDrawerElement } from './au-drawer'
import { AuKbdElement } from './au-kbd'
import { AuChordInputElement } from './au-chord-input'
import { AuTabsElement, AuTabElement, AuTabPanelElement } from './au-tabs'
// Overlay appearance components; the host owns their layers and placement.
import { AuSettingsSectionElement } from './au-settings-section'
import { AuPopoverElement } from './au-popover'
import { AuHovercardElement } from './au-hovercard'

import { installBackdropMaterial } from './surface-material'

export function register(api: ComponentSetApi): void {
  installBackdropMaterial(document)
  api.define('au-icon', AuIconElement)
  api.define('au-icon-button', AuIconButtonElement)
  api.define('au-grip-glyph', AuGripGlyphElement)
  api.define('au-close-button', AuCloseButtonElement)
  api.define('au-viewer-switch', AuViewerSwitchElement)
  api.define('au-chevron', AuChevronElement)
  api.define('au-pane-frame', AuPaneFrameElement)
  api.define('au-pane-header', AuPaneHeaderElement)
  api.define('au-splitter', AuSplitterElement)
  api.define('au-tab-strip-cell', AuTabStripCellElement)
  api.define('au-tab-bar', AuTabBarElement)
  api.define('au-status-dot', AuStatusDotElement)
  api.define('au-input', AuInputElement)
  api.define('au-nav-item', AuNavItemElement)
  // Controlled hierarchy rows and group headers.
  api.define('au-tree-row', AuTreeRowElement)
  api.define('au-section-header', AuSectionHeaderElement)
  api.define('au-nav-group', AuNavGroupElement)
  api.define('au-workspace-mark', AuWorkspaceMarkElement)
  api.define('au-workspace-switcher', AuWorkspaceSwitcherElement)
  api.define('au-button', AuButtonElement)
  api.define('au-card', AuCardElement)
  api.define('au-badge', AuBadgeElement)
  api.define('au-tree', AuTreeElement)
  api.define('au-tree-item', AuTreeItemElement)
  api.define('au-chip', AuChipElement)
  api.define('au-command-palette', AuCommandPaletteElement)
  api.define('au-typed-value-editor', AuTypedValueEditorElement)
  // Reader primitives: labels, status, rules, loading, code and tables.
  api.define('au-tag', AuTagElement)
  api.define('au-pill', AuPillElement)
  api.define('au-divider', AuDividerElement)
  api.define('au-spinner', AuSpinnerElement)
  api.define('au-scroll-area', AuScrollAreaElement)
  api.define('au-output-log', AuOutputLogElement)
  api.define('au-empty-state', AuEmptyStateElement)
  api.define('au-code-block', AuCodeBlockElement)
  api.define('au-diff-line', AuDiffLineElement)
  api.define('au-list-row', AuListRowElement)
  api.define('au-table', AuTableElement)
  api.define('au-table-head', AuTableHeadElement)
  api.define('au-table-body', AuTableBodyElement)
  api.define('au-table-row', AuTableRowElement)
  api.define('au-table-header-cell', AuTableHeaderCellElement)
  api.define('au-table-cell', AuTableCellElement)
  // Form-row primitive, segmented toggle and color control.
  api.define('au-field', AuFieldElement)
  api.define('au-segmented-control', AuSegmentedControlElement)
  api.define('au-color-picker', AuColorPickerElement)
  // Form controls.
  api.define('au-checkbox', AuCheckboxElement)
  api.define('au-switch', AuSwitchElement)
  api.define('au-radio-group', AuRadioGroupElement)
  api.define('au-textarea', AuTextareaElement)
  api.define('au-number-input', AuNumberInputElement)
  api.define('au-select', AuSelectElement)
  api.define('au-banner', AuBannerElement)
  api.define('au-accordion', AuAccordionElement)
  api.define('au-accordion-item', AuAccordionItemElement)
  // The tooltip: the whisper-tier bubble; the universal AuElement
  // title-driver floats it through the host overlay's `tooltip` band via the `showTooltip` seam.
  api.define('au-tooltip', AuTooltipElement)
  // Interactive filter chip for multi-select facets.
  api.define('au-toggle-chip', AuToggleChipElement)
  // Toast appearance component. The host owns notification placement and lifecycle.
  api.define('au-toast', AuToastElement)
  // The floating-menu container + its item row. Used by the chooser.
  // The wash highlight lifts on any card elevation (never a surface hole).
  api.define('au-menu', AuMenuElement)
  api.define('au-menu-item', AuMenuItemElement)
  // The dialog card of the elevation family. Mounted by confirm-surface.
  api.define('au-modal', AuModalElement)
  // Additional component implementations.
  api.define('au-swatch', AuSwatchElement)
  api.define('au-code-sample', AuCodeSampleElement)
  api.define('au-meter', AuMeterElement)
  api.define('au-skeleton', AuSkeletonElement)
  api.define('au-slider', AuSliderElement)
  api.define('au-breadcrumb', AuBreadcrumbElement)
  api.define('au-toolbar', AuToolbarElement)
  api.define('au-toolbar-group', AuToolbarGroupElement)
  api.define('au-toolbar-spacer', AuToolbarSpacerElement)
  api.define('au-detail-list', AuDetailListElement)
  api.define('au-drop-zone', AuDropZoneElement)
  api.define('au-pane-target', AuPaneTargetElement)
  api.define('au-stepper', AuStepperElement)
  api.define('au-pagination', AuPaginationElement)
  api.define('au-combobox', AuComboboxElement)
  api.define('au-drawer', AuDrawerElement)
  // Keyboard-shortcut key cap.
  api.define('au-kbd', AuKbdElement)
  api.define('au-chord-input', AuChordInputElement)
  // The tabbed-panel compound — distinct from au-tab-bar (the container chrome strip).
  api.define('au-tabs', AuTabsElement)
  api.define('au-tab', AuTabElement)
  api.define('au-tab-panel', AuTabPanelElement)
  // Overlay appearance components; the host claims and positions their layers.
  api.define('au-settings-section', AuSettingsSectionElement)
  api.define('au-popover', AuPopoverElement)
  api.define('au-hovercard', AuHovercardElement)
}
