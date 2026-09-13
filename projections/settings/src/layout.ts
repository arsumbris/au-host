import { discordMark, xMark, githubMark } from './brand-assets'

export const STYLE = `
.settings-hub { height:100%; min-height:0; min-width:0; display:grid; grid-template-columns:13rem minmax(0,1fr); container:settings / inline-size; color:var(--au-ink-1); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.settings-hub [hidden] {display:none !important;}
.settings-nav {min-height:0; display:flex; flex-direction:column; padding:var(--au-space-4); border-right:1px solid var(--au-line-1); gap:var(--au-space-5);}
.settings-nav header {display:flex; flex-direction:column; gap:var(--au-space-4);}
.settings-nav h1 {margin:0; font-size:var(--au-t-title); line-height:var(--au-lh-base); font-weight:var(--au-w-strong);}
.settings-nav au-input {width:100%;}
.settings-nav au-scroll-area {flex:1; min-height:0;}
.settings-list {display:flex; flex-direction:column; gap:var(--au-space-1);}
.settings-list au-list-row::part(primary) {white-space:normal; overflow-wrap:anywhere;}
.settings-nav-note,.settings-empty {font-size:var(--au-t-xs); color:var(--au-ink-3); margin:0;}
.settings-main {min-height:0; min-width:0; display:flex; flex-direction:column;}
.settings-context {display:flex; align-items:center; justify-content:space-between; gap:var(--au-space-2); padding:var(--au-space-2) var(--au-space-5); border-bottom:1px solid var(--au-line-1);}
.settings-open {flex-shrink:0;}
.settings-source {min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--au-ink-3); font-size:var(--au-t-xs);}
.settings-body {flex:1; min-height:0; min-width:0; position:relative;}
.settings-page {height:100%; min-height:0; min-width:0;}
.settings-loading {padding:var(--au-space-5); color:var(--au-ink-3);}
.settings-feedback {color:var(--au-color-danger); padding:var(--au-space-3); margin:0; overflow-wrap:anywhere;}
.settings-feedback:empty {display:none;}
.settings-mobile {display:none; min-width:0; flex:1;}
.settings-help-nav {margin-top:var(--au-space-5);}
.settings-help-page {height:100%; min-height:0; display:block;}
.settings-help-content {box-sizing:border-box; max-width:34rem; margin-inline:auto; padding:var(--au-space-7); display:flex; flex-direction:column; gap:var(--au-space-6);}
.settings-help-content h2 {margin:0; color:var(--au-ink-1); font-size:var(--au-t-title); line-height:var(--au-lh-base); font-weight:var(--au-w-strong);}
.settings-help-content p {margin:var(--au-space-2) 0 0; color:var(--au-ink-3); text-wrap:pretty;}
.settings-help-contact {padding-block:var(--au-space-5);}
/* Approved black/white marks keep their proportions; the controls reserve clear space.
 * contrast-color also handles customized surface colours without tinting the artwork. */
.settings-brand-mark {display:block; flex:none; width:16px; height:16px; mask-size:contain; mask-position:center; mask-repeat:no-repeat; background:light-dark(#000,#fff); background:contrast-color(var(--au-color-bg));}
.settings-brand-discord {mask-image:url("${discordMark}");}
.settings-brand-x {mask-image:url("${xMark}");}
.settings-brand-github {mask-image:url("${githubMark}");}
.settings-help-contact .settings-brand-mark {background:light-dark(#fff,#000); background:contrast-color(var(--au-cta-bg, #ededed));}
.settings-help-contact au-button::part(button) {padding:16px; gap:16px; transform:none;}
.settings-help-contact au-button {margin-top:var(--au-space-5);}
.settings-help-links {display:flex; flex-direction:column; gap:var(--au-space-2); padding-top:var(--au-space-4); border-top:1px solid var(--au-line-1);}
.settings-help-links au-list-row {padding:16px; gap:16px; min-height:48px;}
.settings-help-links au-list-row::part(secondary) {white-space:normal;}
@container settings (max-width:42rem) {
 .settings-nav {display:none;} .settings-main {grid-column:1 / -1;} .settings-mobile {display:block;} .settings-source {display:none;}
 .settings-context {padding:var(--au-space-2);}
}
`
