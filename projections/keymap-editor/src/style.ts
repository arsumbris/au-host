export const STYLE = `
.au-kme { height:100%; min-height:0; display:flex; flex-direction:column; color:var(--au-ink-2); font:var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); container-type:inline-size; }
.au-kme au-scroll-area { flex:1; min-height:0; }
.au-kme-content { padding:var(--au-space-4); max-width:64rem; margin-inline:auto; }
.au-kme-toolbar { box-sizing:border-box; width:100%; max-width:64rem; margin-inline:auto; display:grid; gap:var(--au-space-3); padding:var(--au-space-4); border-bottom:1px solid var(--au-line-2); }
.au-kme h1 { margin:0; font:var(--au-w-medium) var(--au-t-title)/var(--au-lh-body) var(--au-font-sans); color:var(--au-ink-1); }
.au-kme h2 { margin:var(--au-space-5) 0 var(--au-space-3); font:var(--au-w-medium) var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); color:var(--au-ink-1); }
.au-kme p { margin:0; color:var(--au-ink-3); max-width:70ch; }
.au-kme-new, .au-kme-import { display:grid; gap:var(--au-space-3); margin-block:var(--au-space-3); }
.au-kme-library { margin-bottom:var(--au-space-5); }
.au-kme-library h2 { margin:0; }
.au-kme-library > p { margin-block:var(--au-space-2); }
.au-kme-library au-input { display:block; margin-top:var(--au-space-3); }
.au-kme-km { margin-bottom:var(--au-space-4); }
.au-kme-km__head { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-2); padding:var(--au-space-2) 0; }
.au-kme-km__name { flex:1; min-width:8ch; color:var(--au-ink-1); font-weight:var(--au-w-medium); overflow-wrap:anywhere; }
.au-kme-km__actions { display:flex; align-items:center; gap:var(--au-space-1); }
.au-kme-bind { display:block; padding:0; margin-block:var(--au-space-2); overflow:hidden; }
.au-kme-bind__trigger { width:100%; box-sizing:border-box; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:var(--au-space-3); padding:var(--au-space-3); border:0; border-radius:inherit; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; transition:background-color var(--au-m-fast) var(--au-e-std); }
.au-kme-bind__trigger:hover { background:var(--au-chrome-hover); }
.au-kme-bind__trigger:focus-visible { outline:1px solid var(--au-focus-outer); outline-offset:-3px; }
.au-kme-change { padding:var(--au-space-1) var(--au-space-2); border-radius:var(--au-radius-row); color:var(--au-ink-3); transition:color var(--au-m-fast) var(--au-e-std), background-color var(--au-m-fast) var(--au-e-std); }
.au-kme-bind__trigger:hover .au-kme-change { color:var(--au-ink-1); background:var(--au-chrome-hover); }
.au-kme-bind__cmd { min-width:0; overflow-wrap:anywhere; color:var(--au-ink-1); }
.au-kme-bind__scope, .au-kme-consumed { display:block; font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-sans); color:var(--au-ink-3); }
.au-kme-bind__scope { margin-top:var(--au-space-1); }
.au-kme-edit { display:grid; gap:var(--au-space-3); padding:0 var(--au-space-3) var(--au-space-3); overflow:hidden; interpolate-size:allow-keywords; height:auto; opacity:1; transition:height var(--au-m-fast) var(--au-e-std), opacity var(--au-m-fast) var(--au-e-std); }
@starting-style { .au-kme-edit { height:0; opacity:0; } }
.au-kme-edit au-chord-input { display:flex; width:100%; border-radius:var(--au-radius-md); transition:box-shadow var(--au-m-fast) var(--au-e-std); }
.au-kme-edit au-chord-input::part(field) { width:100%; min-height:calc(var(--au-space-4) * 3); justify-content:center; transition:box-shadow var(--au-m-fast) var(--au-e-std), border-color var(--au-m-fast) var(--au-e-std); }
.au-kme-edit[data-recording] au-chord-input { box-shadow:0 0 var(--au-space-4) color-mix(in srgb, var(--au-control-focus) 20%, transparent); }
.au-kme-edit[data-recording] .au-kme-recording { color:var(--au-ink-1); }
.au-kme-edit__actions { display:flex; flex-wrap:wrap; gap:var(--au-space-2); }
.au-kme-recording { transition:color var(--au-m-fast) var(--au-e-std); }
.au-kme-empty { padding:var(--au-space-4) var(--au-space-2); color:var(--au-ink-3); }
.au-kme-err { color:var(--au-color-danger); padding:var(--au-space-2) 0; }
.au-kme-status { color:var(--au-ink-3); padding:var(--au-space-2) 0; }
.au-kme-timing { margin-top:var(--au-space-5); border-top:1px solid var(--au-line-2); padding-top:var(--au-space-3); }
.au-kme-timing summary { cursor:pointer; padding:var(--au-space-2); border-radius:var(--au-radius-row); color:var(--au-ink-2); }
.au-kme-timing summary:hover { background:var(--au-chrome-hover); }
.au-kme-timing summary:focus-visible { outline:1px solid var(--au-focus-outer); }
.au-kme-timing__controls { display:flex; gap:var(--au-space-2); align-items:end; flex-wrap:wrap; margin-top:var(--au-space-3); }
.au-kme-timing au-field { max-width:18rem; flex:1; }
.au-kme [hidden] { display:none !important; }
@container (max-width:420px) { .au-kme-bind__trigger { grid-template-columns:minmax(0,1fr) auto; } .au-kme-bind__cmd { grid-column:1/-1; } .au-kme-content, .au-kme-toolbar { padding:var(--au-space-3); } }
@media(prefers-reduced-motion:reduce) { .au-kme * { transition:none !important; } }
`
