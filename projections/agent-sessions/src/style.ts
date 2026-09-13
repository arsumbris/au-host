export const STYLE = `
.sessions-launcher[data-history="true"] > .sessions-history-panel { animation:sessions-history-enter var(--au-m-base) var(--au-e-soft) both; }
.sessions-launcher[data-history-return="true"] > .sessions-start-intro,.sessions-launcher[data-history-return="true"] > .sessions-start-content { animation:sessions-launcher-return var(--au-m-base) var(--au-e-soft) both; }
@keyframes sessions-history-enter { from { opacity:0; transform:translateX(var(--au-space-2)); } to { opacity:1; transform:none; } }
@keyframes sessions-launcher-return { from { opacity:0; transform:translateX(calc(-1 * var(--au-space-2))); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion:reduce) {
  .sessions-launcher[data-history="true"] > .sessions-history-panel,.sessions-launcher[data-history-return="true"] > .sessions-start-intro,.sessions-launcher[data-history-return="true"] > .sessions-start-content { animation:none; }
}

.sessions-history-back::part(label) { display:flex; align-items:center; gap:var(--au-space-1); }
.sessions-history-back { margin-inline-start:calc(-1 * var(--au-space-2)); }
.sessions-history-back::part(button) { color:var(--au-ink-3); }
.sessions-launch-pending { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--au-space-3); text-align:center; padding:var(--au-space-5); }
.sessions-launcher[data-spacious="true"][aria-busy="true"] > .sessions-start-intro { display:none!important; }
.sessions-launcher[data-spacious="true"][aria-busy="true"] .sessions-launch-row,.sessions-launcher[data-spacious="true"][aria-busy="true"] .sessions-history { display:none; }
.sessions-launcher[data-spacious="true"][aria-busy="true"] > .sessions-start-content { flex:1; justify-content:center; }

.sessions-launcher[data-history="true"] { justify-content:flex-start; overflow:hidden; }
.sessions-launcher[data-history="true"] > .sessions-start-intro,.sessions-launcher[data-history="true"] > .sessions-start-content { display:none!important; }
.sessions-launcher > .sessions-history-panel { width:100%; max-width:calc(var(--au-space-4)*42); height:100%; min-height:0; margin-inline:auto; background:transparent; }
.sessions-launcher > .sessions-history-panel > au-button { align-self:flex-start; }
.sessions-launcher .sessions-history-list { flex:1; min-height:0; min-width:0; }

.sessions-history-panel [hidden] { display:none!important; }
.sessions-history-panel { box-sizing:border-box; width:min(26rem,calc(100vw - var(--au-space-6))); padding:var(--au-space-4); display:flex; flex-direction:column; gap:var(--au-space-3); color:var(--au-ink-1); background:var(--au-surface-1); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.sessions-history-panel h3,.sessions-history-panel p { margin:0; }
.sessions-history-panel h3 { font-size:var(--au-t-sm); font-weight:var(--au-w-medium); }
.sessions-history-heading,.sessions-history-summary { display:flex; align-items:center; justify-content:space-between; gap:var(--au-space-3); width:100%; min-width:0; }
.sessions-history-identity { display:flex; flex-direction:column; gap:var(--au-space-1); min-width:0; overflow-wrap:anywhere; }
.sessions-history-summary > au-button { flex-shrink:0; }
.sessions-history-details { width:100%; min-width:0; color:var(--au-ink-3); font-size:var(--au-t-xs); }
.sessions-history-details summary { cursor:pointer; }
.sessions-history-details summary:focus-visible { outline:1px solid var(--au-control-focus,var(--au-focus-outer)); outline-offset:-1px; border-radius:var(--au-radius-sm); }
.sessions-history-details code,.sessions-history-details span { display:block; margin-top:var(--au-space-2); }

.sessions-history-list { min-height:0; min-width:0; }
.sessions-history-item { display:flex; flex-direction:column; align-items:flex-start; gap:var(--au-space-2); padding-block:var(--au-space-3); border-top:1px solid var(--au-line-1); }
.sessions-history-item code { overflow-wrap:anywhere; font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); }

.sessions-history { align-self:center; }
.sessions-history::part(label) { display:flex; align-items:center; gap:var(--au-space-2); }
.sessions-launcher[data-spacious="false"] .sessions-history { align-self:flex-start; }

.runtime-settings { height:100%; }
.runtime-settings-content { max-width:calc(var(--au-space-4)*44); margin-inline:auto; padding:var(--au-space-6); display:flex; flex-direction:column; gap:var(--au-space-4); color:var(--au-ink-1); font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); }
.runtime-settings-content h2,.runtime-settings-content h3 { margin:0; font-weight:var(--au-w-medium); }
.runtime-settings-content h2 { font-size:var(--au-t-title); }
.runtime-settings-content h3 { font-size:var(--au-t-sm); }
.runtime-settings [hidden] { display:none!important; }
.runtime-settings-content { box-sizing:border-box; width:100%; }
.runtime-settings-content > .sessions-hint:first-child { margin-bottom:calc(-1 * var(--au-space-2)); }
.runtime-sections { display:flex; flex-direction:column; min-width:0; }
.runtime-section > au-button { align-self:flex-start; }
.runtime-executable { margin:0; color:var(--au-ink-3); font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); overflow-wrap:anywhere; }
.runtime-actions { display:flex; flex-wrap:wrap; gap:var(--au-space-2); align-items:center; }
.runtime-settings .sessions-feedback[data-error] { color:var(--au-color-danger); }
.runtime-settings-content h3 { overflow-wrap:anywhere; }
.runtime-section { display:flex; flex-direction:column; gap:var(--au-space-3); padding-block:var(--au-space-4); border-top:1px solid var(--au-line-1); }
.sessions-launcher [hidden],.profiles-editor [hidden] { display:none !important; }
.sessions-launcher,.profiles-editor,.session-empty { box-sizing:border-box; font:var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); color:var(--au-ink-1); }
.sessions-launcher { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; overflow:auto; padding:var(--au-space-2); }
.sessions-launcher[data-spacious="false"] { padding-inline-end:calc(var(--au-space-2) + var(--au-pane-trailing-action-space, 0px)); }
.sessions-start-content { flex:0 0 auto; display:flex; flex-direction:column; gap:var(--au-space-3); min-width:0; }
.sessions-start-intro { display:none; }
.sessions-launcher[data-spacious="true"] .sessions-start-intro { display:flex; flex:1; min-height:0; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:var(--au-space-2); padding:var(--au-space-6); position:relative; isolation:isolate; overflow:hidden; }
.sessions-launcher[data-spacious="true"] { justify-content:safe center; align-items:center; overflow:auto; padding:var(--au-space-5); }
.sessions-launcher[data-spacious="true"] .sessions-start-intro { flex:0 0 auto; width:100%; box-sizing:border-box; max-width:calc(var(--au-space-4)*30); padding:var(--au-space-5) var(--au-space-2); gap:var(--au-space-3); }
.sessions-launcher[data-spacious="true"] .sessions-empty-message { color:var(--au-ink-1); font-size:var(--au-t-title); font-weight:var(--au-w-medium); }
.sessions-launcher[data-spacious="true"] .sessions-start-content { width:100%; max-width:calc(var(--au-space-4)*30); flex:0 0 auto; }
.sessions-launcher[data-history="true"] { padding:var(--au-space-3); }
.sessions-launcher[data-history="true"][data-spacious="false"] { padding-inline-end:calc(var(--au-space-3) + var(--au-pane-trailing-action-space, 0px)); }
.sessions-launcher[data-history="true"] > .sessions-history-panel { padding:0; }
.sessions-launcher[data-spacious="true"] .sessions-copy-command { width:100%; }
.sessions-copy-command::part(button) { width:100%; justify-content:center; }
.sessions-copy-command::part(label) { display:inline-flex; align-items:center; justify-content:center; gap:var(--au-space-2); }
.sessions-copy-command au-icon { flex:none; }
.sessions-launcher[data-spacious="true"] .sessions-launch-row { flex-direction:column; align-items:stretch; gap:var(--au-space-3); }
.sessions-launcher[data-spacious="true"] .sessions-launch-row > au-button { flex:0 0 auto; margin:0; width:100%; }
.sessions-launcher[data-spacious="true"] .sessions-launch-row > au-button::part(button) { width:100%; }
.sessions-launcher[data-spacious="true"] .sessions-profile-trigger::part(label) { justify-content:center; }
.sessions-launcher[data-spacious="true"] .sessions-launch-row > au-button:last-child::part(label) { color:inherit; }
.sessions-empty-mist { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:0; mask-image:radial-gradient(ellipse at center,black 20%,transparent 70%); }
.sessions-empty-message,.sessions-empty-guidance,.sessions-profile-pill { position:relative; z-index:1; }
.sessions-empty-message { margin:0; color:var(--au-ink-3); font-size:var(--au-t-sm); text-wrap:balance; }
.sessions-empty-guidance { margin:0; color:var(--au-ink-4); font-size:var(--au-t-xs); text-wrap:balance; }
.sessions-profile-pill::part(button) { border-radius:var(--au-radius-pill); background:transparent; color:var(--au-ink-3); }
.sessions-profile-pill::part(label) { display:flex; align-items:center; gap:var(--au-space-2); font-size:var(--au-t-xs); font-weight:var(--au-w-medium); }
.sessions-pill-name { color:var(--au-ink-4); }
.sessions-launch-row { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-2); justify-content:flex-start; width:100%; min-width:0; }
.sessions-launch-row au-button:first-child { flex:0 0 auto; min-width:0; }
.sessions-launch-row au-button:first-child::part(button) { width:100%; }
.sessions-launch-row au-button:first-child::part(label) { display:flex; align-items:center; justify-content:center; gap:var(--au-space-2); }
.sessions-profile-trigger { flex:1 1 calc(var(--au-space-4)*10); margin-inline-start:auto; }
.sessions-launch-row au-button:last-child { max-width:100%; min-width:0; }
.sessions-launch-row au-button:last-child::part(button) { box-sizing:border-box; width:100%; min-width:0; max-width:100%; padding-inline:var(--au-space-2); }
.sessions-launch-row au-button:last-child::part(label) { display:flex; flex:1; min-width:0; overflow:hidden; align-items:center; gap:var(--au-space-2); color:var(--au-ink-3); font-weight:var(--au-w-medium); }
.sessions-trigger-adapter { color:var(--au-ink-4); }
.sessions-trigger-profile { color:var(--au-ink-3); }
.sessions-launch-row au-button:last-child span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sessions-launch-row au-button:last-child au-icon { flex-shrink:0; }
/* The persistent start view is one horizontal toolbar above session tabs. */
.sessions-launcher[data-spacious="false"] .sessions-launch-row { flex-direction:row; flex-wrap:nowrap; }
.sessions-launcher[data-spacious="false"] .sessions-start-content { width:100%; }
.sessions-launcher[data-spacious="false"] .sessions-copy-command,
.sessions-launcher[data-spacious="false"] .sessions-history { display:none; }
.sessions-trigger-gear { display:none; }
.sessions-launcher[data-spacious="false"] .sessions-profile-trigger { flex:1 1 0; min-width:0; margin-inline-start:auto; }
.sessions-launcher[data-spacious="false"] .sessions-profile-trigger::part(label) { justify-content:flex-end; }
.sessions-launcher[data-spacious="false"] .sessions-trigger-profile { flex:0 1 auto; min-width:0; }
.sessions-launcher[data-narrow="true"][data-spacious="false"] .sessions-trigger-adapter { display:none; }
.sessions-launcher[data-icon-picker="true"][data-spacious="false"] .sessions-profile-trigger { flex:0 0 var(--au-space-8); width:var(--au-space-8); }
.sessions-launcher[data-icon-picker="true"][data-spacious="false"] .sessions-profile-trigger > :not(.sessions-trigger-gear) { display:none; }
.sessions-launcher[data-icon-picker="true"][data-spacious="false"] .sessions-trigger-gear { display:block; }
.sessions-launcher[data-icon-picker="true"][data-spacious="false"] .sessions-profile-trigger::part(label) { justify-content:center; }
.sessions-options { width:min(calc(var(--au-space-4)*20),calc(100vw - var(--au-space-8))); }
.sessions-menu-section { display:flex; flex-direction:column; gap:var(--au-space-1); }
.sessions-menu-heading { display:flex; align-items:center; justify-content:space-between; padding-inline:var(--au-space-2) var(--au-space-1); color:var(--au-ink-3); font-size:var(--au-t-xs); }
.sessions-options au-segmented-control { display:flex; }
.sessions-options-list { max-height:min(calc(var(--au-row-h)*6),40vh); }
.sessions-profile-list { display:flex; flex-direction:column; gap:var(--au-space-0-5); }
.sessions-options au-list-row { min-height:var(--au-row-h); }
.sessions-options [hidden] { display:none!important; }
.sessions-selection-summary { margin:0; padding:var(--au-space-2); border-top:1px solid var(--au-line-1); color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-sm); text-wrap:pretty; }
.sessions-hint,.sessions-feedback { margin:0; font-size:var(--au-t-xs); color:var(--au-ink-3); overflow-wrap:anywhere; }
.sessions-feedback:empty { display:none; }
.sessions-launcher .sessions-feedback { text-align:center; }
.sessions-feedback[data-copied] { animation:sessions-copy-confirm var(--au-m-base) var(--au-e-std); }
@keyframes sessions-copy-confirm { from { opacity:0; transform:translateY(var(--au-space-1)); } to { opacity:1; transform:none; } }
@media(prefers-reduced-motion:reduce) { .sessions-feedback[data-copied] { animation:none; } }
.sessions-error-detail { white-space:pre-wrap; overflow-wrap:anywhere; font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); }
.sessions-launcher au-accordion-item { --au-accordion-pad-x:var(--au-space-1); --au-accordion-indent:var(--au-space-1); }
.session-empty { height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; gap:var(--au-space-3); padding:var(--au-space-6); }
.session-empty h2 { margin:0; font-size:var(--au-t-title); font-weight:var(--au-w-medium); }
.session-empty p { max-width:calc(var(--au-space-1)*65); margin:0; color:var(--au-ink-3); }
.profiles-editor { height:100%; min-height:0; display:flex; flex-direction:column; }
.profiles-editor { container-type:inline-size; }
.profiles-title { padding:var(--au-space-5) var(--au-space-5) var(--au-space-2); display:flex; flex-direction:column; gap:var(--au-space-2); }
.profiles-title h2 { margin:0; font-size:var(--au-t-title); font-weight:var(--au-w-medium); }
.profiles-feedback-region { display:flex; flex-direction:column; align-items:flex-start; gap:var(--au-space-2); padding:var(--au-space-3); }
.profiles-feedback-region .profile-feedback { padding:0; }
.profiles-content au-empty-state > .profiles-feedback-region { align-items:center; text-align:center; padding:var(--au-space-2) 0 0; max-width:calc(var(--au-space-4)*28); }
.profiles-editor[data-loaded="false"] .profiles-head,.profiles-editor[data-loaded="false"] .profiles-body,.profiles-editor[data-loaded="false"] .profiles-actions { display:none; }
.profiles-editor[data-loaded="false"] .profiles-feedback-region { flex:1; box-sizing:border-box; width:100%; max-width:calc(var(--au-space-4)*48); margin-inline:auto; padding:var(--au-space-5); justify-content:center; }
.profiles-title,.profiles-head,.profiles-content { box-sizing:border-box; width:100%; max-width:calc(var(--au-space-4)*48); margin-inline:auto; }
.profiles-identity { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:var(--au-space-5); }
.profiles-capabilities { display:flex; flex-direction:column; gap:var(--au-space-2); padding-block:var(--au-space-4); border-top:1px solid var(--au-line-1); }
.profiles-content > au-button { align-self:flex-start; }
.profiles-capabilities > au-accordion-item { border-bottom:1px solid var(--au-line-1); }
@container (max-width:480px) { .profiles-identity { grid-template-columns:minmax(0,1fr); } }
.profiles-head,.profiles-actions { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au-space-2); padding:var(--au-space-3); }
.profiles-head { border-bottom:1px solid var(--au-line-1); }
.profiles-head au-select { flex:1; min-width:calc(var(--au-space-1)*30); }
.profiles-body { flex:1; min-height:0; }
.profiles-content { padding:var(--au-space-5); display:flex; flex-direction:column; gap:var(--au-space-3); }
.profiles-content h2 { margin:0; font-size:var(--au-t-sm); font-weight:var(--au-w-strong); }
.profiles-content au-accordion-item { --au-accordion-pad-x:var(--au-space-2); --au-accordion-indent:var(--au-space-2); }
.profile-field { display:flex; flex-direction:column; gap:var(--au-space-2); min-width:0; }
.profile-origin-group { display:flex; flex-direction:column; gap:var(--au-space-1); min-width:0; padding-top:var(--au-space-3); }
.profile-origin-heading { margin:0; color:var(--au-ink-3); font-size:var(--au-t-xs); line-height:var(--au-lh-xs); font-weight:var(--au-w-medium); overflow-wrap:anywhere; }
.profile-option { display:flex; align-items:flex-start; gap:var(--au-space-2); padding-block:var(--au-space-1); }
.profile-option-entry { display:flex; align-items:flex-start; gap:var(--au-space-3); padding-block:var(--au-space-2); border-bottom:1px solid var(--au-line-1); }
.profile-option-entry .profile-option { flex:1; min-width:0; }
.profile-option-entry > au-button { flex-shrink:0; }
@container (max-width:480px) { .profile-option-entry { flex-direction:column; gap:var(--au-space-1); } .profile-option-entry > au-button { align-self:flex-end; } }
.profile-option-content { min-width:0; overflow-wrap:anywhere; }
.profile-option-content strong { font-weight:var(--au-w-medium); }
.profile-option-content p { margin:0; color:var(--au-ink-3); font-size:var(--au-t-xs); }
@media (forced-colors:active) { .sessions-history-details summary:focus-visible { outline-color:Highlight; } }
.profile-source { color:var(--au-ink-4); font:var(--au-t-xs)/var(--au-lh-xs) var(--au-font-mono); overflow-wrap:anywhere; }
.profile-feedback { padding:0 var(--au-space-3); margin:0; color:var(--au-ink-3); }
.profile-feedback[data-error] { color:var(--au-color-danger); }
.profile-draft { color:var(--au-ink-3); margin-inline-end:auto; font-size:var(--au-t-xs); }
.profiles-actions { border-top:1px solid var(--au-line-1); }

.sessions-launcher[data-spacious="false"] .sessions-launch-row { gap:var(--au-space-2); flex-wrap:nowrap; }
.sessions-launcher[data-spacious="false"] .sessions-profile-trigger { flex:1 1 0; width:auto; margin-inline-start:auto; }
.sessions-launcher[data-spacious="false"] .sessions-profile-trigger::part(label) { justify-content:flex-end; }
.sessions-launcher[data-spacious="false"] .sessions-profile-trigger > :not(.sessions-trigger-gear) { display:initial; }
.sessions-launcher[data-spacious="false"] .sessions-trigger-gear { display:none; }
.sessions-launcher[data-narrow="true"][data-spacious="false"] .sessions-trigger-adapter { display:none; }
.sessions-launcher[data-narrow="true"][data-spacious="false"] .sessions-trigger-profile { flex:0 1 auto; }

`
