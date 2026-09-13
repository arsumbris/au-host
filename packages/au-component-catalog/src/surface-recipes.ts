/** Presentation recipes for light-DOM compositions. Install through the owner's scoped stylesheet.
 * Components retain material, focus, scroll and state paint; authors supply data and behavior.
 */
export const surfaceRecipes = `
.au-content-pane { container-type:inline-size; display:flex; flex-direction:column; min-inline-size:0; min-block-size:0; block-size:100%; color:var(--au-ink-2); font-family:var(--au-font-sans); }
.au-content-pane > au-scroll-area { flex:1; min-block-size:0; }
.au-content-measure { box-sizing:border-box; inline-size:100%; max-inline-size:50rem; margin-inline:auto; padding:var(--au-space-4) clamp(var(--au-space-4), 4cqi, var(--au-space-7)); }
.au-content-header, .au-content-footer { flex:none; min-inline-size:0; }
.au-content-state { max-inline-size:32rem; }
.au-picker { display:flex; flex-direction:column; gap:var(--au-space-3); inline-size:100%; block-size:100%; min-inline-size:0; min-block-size:0; box-sizing:border-box; font-family:var(--au-font-sans); color:var(--au-ink-2); }
.au-picker-heading { flex:none; margin:0; color:var(--au-ink-1); font-size:var(--au-t-sm); line-height:var(--au-lh-sm); font-weight:var(--au-w-medium); letter-spacing:var(--au-ls-snug); overflow-wrap:anywhere; }
.au-picker-search { flex:none; box-sizing:border-box; inline-size:100%; min-inline-size:0; block-size:var(--au-row-h); padding-inline:var(--au-space-3); border:1px solid var(--au-line-2); border-radius:var(--au-radius-md); background:var(--au-color-surface-1); color:var(--au-ink-1); font:var(--au-t-base)/var(--au-lh-base) var(--au-font-sans); }
.au-picker-search:focus-visible { outline:1px solid var(--au-control-focus); outline-offset:-1px; }
.au-picker > au-scroll-area { flex:1; min-block-size:0; }
.au-picker-list { min-inline-size:0; padding:var(--au-space-1); }
.au-picker-section { padding:var(--au-space-2) var(--au-space-2) var(--au-space-1); color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-xs); font-weight:var(--au-w-medium); }
.au-picker-options { display:flex; flex-direction:column; gap:var(--au-space-0-5); }
.au-picker-option { display:block; box-sizing:border-box; inline-size:100%; min-inline-size:0; padding:0; border:0; border-radius:var(--au-radius-row); background:transparent; color:inherit; text-align:start; cursor:pointer; }
.au-picker-option > au-list-row { pointer-events:none; }
.au-picker-footer { flex:none; display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-3); min-inline-size:0; color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-xs); }
.au-picker-footer > span { display:inline-flex; align-items:center; gap:var(--au-space-1); }
.au-picker-note { color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-xs); overflow-wrap:anywhere; }
`
