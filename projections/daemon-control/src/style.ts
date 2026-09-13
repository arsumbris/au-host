export const STYLE = `
.au-daemon { box-sizing: border-box; min-width: 0; min-height: 0; font: var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); display: flex; flex-direction: column; gap: var(--au-space-4); padding: var(--au-space-5); width: min(100%, 760px); margin-inline: auto; }
.au-daemon > * { flex-shrink: 0; min-width: 0; }
.au-daemon-paths { overflow-wrap: anywhere; color: var(--au-ink-3); display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-daemon-paths b { color: var(--au-ink-1); font-weight: var(--au-w-strong); }
.au-daemon-trace { display: flex; align-items: center; gap: var(--au-space-1-5); margin-top: var(--au-space-1); cursor: pointer; user-select: none; }
.au-daemon-trace-hint { color: var(--au-ink-3); flex-basis: 100%; font-size: var(--au-t-xs); }
.au-daemon-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--au-space-2); }
.au-daemon-pill { color: var(--au-ink-3); }
.au-daemon-detail { min-width: 0; overflow-wrap: anywhere; color: var(--au-ink-3); }
.au-daemon-error { color: var(--au-color-danger); }
.au-daemon-log { height: calc(var(--au-space-1) * 50); min-height: calc(var(--au-space-1) * 20); }
.au-daemon-sec { min-width: 0; --au-accordion-pad-x: var(--au-space-2); --au-accordion-indent: var(--au-space-2); }
.au-daemon-sec-body { display: flex; flex-direction: column; gap: var(--au-space-1-5); }
.au-daemon-td { padding: var(--au-space-0-5) 0 var(--au-space-2); display: flex; flex-direction: column; gap: var(--au-space-1-5); border-bottom: 1px solid var(--au-line-1); }
.au-daemon-scroll { height: 100%; min-height: 0; }
.au-daemon h2 { margin: 0; font: var(--au-w-strong) var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); color: var(--au-ink-1); }
.au-daemon-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--au-space-2); }
.au-daemon-services { display: flex; flex-direction: column; gap: var(--au-space-2); min-width: 0; }
.au-daemon-services { padding-bottom: var(--au-space-3); border-bottom: 1px solid var(--au-line-1); }
.au-daemon-row { padding-block: var(--au-space-4); }
.au-daemon-actions { display: flex; gap: var(--au-space-2); margin-left: auto; }
.au-daemon-hint { margin: 0; color: var(--au-ink-3); }
.au-daemon-error:empty { display: none; }
.au-daemon-detail, .au-daemon-paths b { font-family: var(--au-font-mono); overflow-wrap: anywhere; }
.au-daemon-trace { flex-wrap: wrap; }

.au-daemon-row + .au-daemon-row { border-top:1px solid var(--au-line-1); }
.au-daemon-identity { flex:1 1 260px; min-width:0; }
.au-daemon-service-title { display:flex; align-items:center; gap:var(--au-space-2); flex-wrap:wrap; }
.au-daemon-identity p { margin:var(--au-space-1) 0 0; color:var(--au-ink-3); }
.au-daemon-identity .au-daemon-service-notice { color:var(--au-color-warn); }
.au-daemon-service-notice:empty { display:none; }
.au-daemon-detail { white-space:pre-line; font-size:var(--au-t-xs); }
.au-daemon-paths > div { display:flex; flex-direction:column; gap:var(--au-space-1); padding-bottom:var(--au-space-2); }
.au-daemon-trace { align-items:flex-start; }
.au-daemon-sec-body { padding-block:var(--au-space-3); gap:var(--au-space-4); }
.au-daemon-log { height:calc(var(--au-space-1) * 65); }
.au-daemon-config-actions > [hidden] { display:none; }
.au-daemon-config-actions { display:flex; flex-wrap:wrap; gap:var(--au-space-2); }
.au-daemon-config-feedback { margin:0; color:var(--au-ink-2); }
.au-daemon-config-feedback:empty { display:none; }
.au-daemon-config-source { margin:0; font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); color:var(--au-ink-3); overflow-wrap:anywhere; }
.au-daemon-config-feedback[data-error] { color:var(--au-color-danger); }
`
