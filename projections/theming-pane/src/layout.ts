export const LAYOUT_CSS = `
.au-tp {height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; container:appearance / inline-size; font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans);}
.au-tp [hidden] {display:none !important;}
.au-tp-head {display:flex; flex-wrap:wrap; align-items:start; justify-content:space-between; gap:var(--au-space-3); padding:var(--au-space-6) var(--au-space-6) var(--au-space-4);}
.au-tp h1 {margin:0; font-size:var(--au-t-h2); line-height:var(--au-lh-h2); font-weight:var(--au-w-strong);}
.au-tp-eyebrow {margin:0 0 var(--au-space-1); color:var(--au-ink-3); font-size:var(--au-t-xs);}
.au-tp-intro {margin:var(--au-space-2) 0 0; color:var(--au-ink-3);}
au-segmented-control.au-tp-sections {margin:0 var(--au-space-6) var(--au-space-4); align-self:flex-start; min-width:0; max-inline-size:calc(100% - 2 * var(--au-space-6)); box-sizing:border-box; flex-wrap:wrap;}
.au-tp-scroll {flex:1; min-height:0;}
.au-tp-content {max-width:58rem; padding:var(--au-space-2) var(--au-space-6) var(--au-space-6); margin-inline:0;}
.au-tp-section-intro h2 {font-size:var(--au-t-title); font-weight:var(--au-w-strong); margin:0;}
.au-tp-section-intro p {color:var(--au-ink-3); margin:var(--au-space-1) 0 var(--au-space-4);}
.au-tp-adjust {display:flex; flex-direction:column; gap:var(--au-space-4);}
.au-tp-custom-group {margin-top:var(--au-space-3);}
.au-tp-custom-group h3 {font-size:var(--au-t-base); font-weight:var(--au-w-strong); margin:0 0 var(--au-space-1);}
.au-tp-feedback {color:var(--au-ink-3); font-size:var(--au-t-xs); margin:var(--au-space-1) 0; overflow-wrap:anywhere;}
.au-tp-token-row::part(label) {min-width:0;}
.au-tp-token-row {grid-template-columns:minmax(0,1fr) minmax(0,1fr); padding-block:var(--au-space-3); border-bottom:1px solid var(--au-line-1);}
.au-tp-footer {flex:none; display:flex; align-items:center; justify-content:space-between; gap:var(--au-space-3); padding:var(--au-space-3) var(--au-space-6); border-top:1px solid var(--au-line-1); flex-wrap:wrap;}
.au-tp-save-state {font-size:var(--au-t-xs); color:var(--au-ink-2);}
.au-tp-actions,.au-tp-theme-actions {display:flex; flex-wrap:wrap; gap:var(--au-space-2); align-items:center;}
.au-tp-theme-actions {padding-block:var(--au-space-3);}
.au-tp-theme-actions > au-input {flex:1 1 12rem;}
.au-tp-broken {padding:var(--au-space-3); color:var(--au-color-danger); overflow-wrap:anywhere;}
.au-tp-broken h3 {font-size:var(--au-t-sm); margin:0;}
.au-tp-broken-row {font-size:var(--au-t-xs);}
.au-tp-theme-list {display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--au-space-3); margin:var(--au-space-4) 0;}
.au-tp-theme-choice {min-width:0; flex-direction:column; align-items:stretch; padding:var(--au-space-2);}
.au-tp-theme-choice::part(leading) {width:100%;}
.au-tp-theme-choice::part(primary),.au-tp-theme-choice::part(secondary) {white-space:normal;overflow-wrap:anywhere;}
.au-tp-theme-choice au-list-row::part(primary),.au-tp-theme-choice au-list-row::part(secondary) {white-space:normal; overflow-wrap:anywhere;}
.au-tp-theme-mini {height:6rem; display:grid; grid-template-columns:28% 1fr; gap:var(--au-space-1); padding:var(--au-space-2); border-radius:var(--au-radius-panel); margin-bottom:var(--au-space-2); width:100%; box-sizing:border-box; overflow:hidden; background:var(--mini-bg); color:var(--mini-ink); border:1px solid var(--au-line-2); pointer-events:none;}
.au-tp-theme-mini aside {background:var(--mini-pane); border-radius:var(--au-radius-row); padding:var(--au-space-2); display:flex; flex-direction:column; gap:var(--au-space-1);}
.au-tp-theme-mini i {display:block; height:3px; background:currentColor; opacity:.35; border-radius:var(--au-radius-row);}
.au-tp-theme-mini article {padding:var(--au-space-2); background:var(--mini-pane); border-radius:var(--au-radius-row);}
.au-tp-theme-mini strong {font-size:var(--au-t-xs); font-weight:var(--au-w-strong);}
.au-tp-theme-mini article i {margin-top:var(--au-space-2);}
.au-tp-authoring {margin-top:var(--au-space-5); padding-top:var(--au-space-4); border-top:1px solid var(--au-line-1);}
@container appearance (max-width:30rem) {
 .au-tp-theme-list {grid-template-columns:repeat(2,minmax(0,1fr));}
 .au-tp-head {padding:var(--au-space-4);} au-segmented-control.au-tp-sections {margin-inline:var(--au-space-4); max-inline-size:calc(100% - 2 * var(--au-space-4));}
 .au-tp-content,.au-tp-footer {padding-inline:var(--au-space-4);}
 .au-tp-token-row {grid-template-columns:minmax(0,1fr); gap:var(--au-space-2);}
 .au-tp-token-row::part(label),.au-tp-token-row::part(control) {grid-column:1;}
}
`
