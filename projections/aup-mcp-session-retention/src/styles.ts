export const STYLE = `
.au-ret {height:100%;min-height:0;display:flex;color:var(--au-ink-1);font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans);container-type:inline-size;}
.au-ret > au-scroll-area {flex:1;min-width:0;min-height:0;}
.au-ret-content {box-sizing:border-box;padding:var(--au-space-5);width:100%;max-width:1100px;margin-inline:auto;display:flex;flex-direction:column;gap:var(--au-space-5);}
.au-ret h2,.au-ret h3,.au-ret p {margin:0;}
.au-ret h2 {font-size:var(--au-t-md);font-weight:var(--au-w-strong);}
.au-ret h3 {font-size:var(--au-t-sm);font-weight:var(--au-w-strong);}
.au-ret-intro,.au-ret-hint {color:var(--au-ink-3);max-width:65ch;}
.au-ret-layout {display:grid;grid-template-columns:minmax(240px,.8fr) minmax(280px,1.2fr);gap:var(--au-space-5);}
.au-ret-section {display:flex;flex-direction:column;gap:var(--au-space-3);min-width:0;}
.au-ret-sessions {border-left:1px solid var(--au-line-1);padding-left:var(--au-space-5);}
.au-ret-row {display:flex;align-items:center;gap:var(--au-space-2);flex-wrap:wrap;}
.au-ret-row h3 {flex:1;}
.au-ret-current {color:var(--au-ink-2);}
.au-ret-field {display:flex;flex-direction:column;gap:var(--au-space-2);align-items:flex-start;}
.au-ret-field au-number-input {width:9em;max-width:100%;}
.au-ret-message {font-size:var(--au-t-xs);overflow-wrap:anywhere;}
.au-ret-message:empty {display:none;}
.au-ret-error {color:var(--au-color-danger);}
.au-ret-preview {border-block:1px solid var(--au-line-1);padding-block:var(--au-space-3);display:flex;flex-direction:column;gap:var(--au-space-3);}
.au-ret-preview[hidden] {display:none;}
.au-ret-preview au-scroll-area {max-height:260px;min-height:0;}
.au-ret-list {display:flex;flex-direction:column;min-width:0;}
.au-ret-item {padding-block:var(--au-space-3);border-bottom:1px solid var(--au-line-1);display:flex;flex-direction:column;gap:var(--au-space-2);min-width:0;}
.au-ret-id {font:var(--au-w-strong) var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono);overflow-wrap:anywhere;}
.au-ret-meta {display:flex;gap:var(--au-space-2) var(--au-space-4);flex-wrap:wrap;color:var(--au-ink-3);font-size:var(--au-t-xs);}
.au-ret-confirm {display:flex;flex-direction:column;gap:var(--au-space-2);}
.au-ret-danger {color:var(--au-color-danger);}
.au-ret-item au-button {align-self:flex-start;}
.au-ret-loading {display:flex;align-items:center;gap:var(--au-space-2);color:var(--au-ink-3);}
@container(max-width:680px){.au-ret-content{padding:var(--au-space-3);}.au-ret-layout{grid-template-columns:minmax(0,1fr);}.au-ret-sessions{border-left:0;border-top:1px solid var(--au-line-1);padding-left:0;padding-top:var(--au-space-5);}}
`
