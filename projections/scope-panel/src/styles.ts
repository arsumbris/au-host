export const CSS = `
/* TRANSPARENT on purpose: the CONTAINER owns the surface (its region card is the panel), the
 * projection is only content. Painting our own background here punches a darker hole through that
 * card, so the masthead and the body read as two different surfaces instead of one continuous panel.
 * Interior wells below (the raw-text au-textarea, .au-scp-picker, the pattern input) keep their own elevation. */
.au-scp { font: var(--au-t-xs) var(--au-font-sans); height: 100%; box-sizing: border-box; color: var(--au-ink-1); background: transparent; }
.au-scp-content { padding: var(--au-space-2-5) var(--au-space-3); display: flex; flex-direction: column; gap: var(--au-space-2-5); min-width: 0; }
.au-scp-intro { font-size: var(--au-t-2xs); color: var(--au-ink-4); }
.au-scp-empty { color: var(--au-ink-4); font-style: italic; }
.au-scp-banner { font-size: var(--au-t-2xs); color: var(--au-color-warn); border: 1px solid color-mix(in srgb, var(--au-color-warn) 40%, transparent); border-radius: var(--au-radius-sm); padding: var(--au-space-1) var(--au-space-2); }

.au-scp-member { border: 1px solid var(--au-line-2); border-radius: var(--au-radius-sm); overflow: hidden; }
.au-scp-body { padding: var(--au-space-2); display: flex; flex-direction: column; gap: var(--au-space-2-5); border-top: 1px solid var(--au-line-2); }

.au-scp-fieldhead { font-size: var(--au-t-2xs); text-transform: uppercase; letter-spacing: var(--au-ls-label); color: var(--au-ink-4); margin-bottom: var(--au-space-1); display: flex; align-items: center; gap: var(--au-space-2); }

/* structured rules */
.au-scp-rules { display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-scp-rule { display: flex; align-items: center; gap: var(--au-space-2); padding: var(--au-space-0-5) var(--au-space-1); border-radius: var(--au-radius-sm); }
.au-scp-rule:hover { background: var(--au-chrome-hover); }
.au-scp-rule-tag { flex: 0 0 auto; font-size: var(--au-t-2xs); text-transform: none; color: var(--au-ink-3); width: 64px; white-space: nowrap; }
.au-scp-rule-tag.neg { color: var(--au-color-ok); }
.au-scp-rule-text { flex: 1; min-width: 0; font: var(--au-t-2xs) var(--au-font-mono); color: var(--au-ink-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.au-scp-rule.comment .au-scp-rule-text, .au-scp-rule.blank .au-scp-rule-text { color: var(--au-ink-4); font-style: italic; }
.au-scp-rules-empty { font-size: var(--au-t-2xs); color: var(--au-ink-4); font-style: italic; padding: var(--au-space-0-5) var(--au-space-1); }

/* toolbar + pickers — the controls are <au-button> / <au-list-row> / <au-chevron> / <au-input>; these keep only LAYOUT. */
.au-scp-toolbar { display: flex; flex-wrap: wrap; gap: var(--au-space-1-5); align-items: center; }
.au-scp-picker { border: 1px solid var(--au-line-2); border-radius: var(--au-radius-sm); padding: var(--au-space-1-5); max-height: 240px; overflow: auto; background: var(--au-elev-3-fill); }
.au-scp-picker-empty { font-size: var(--au-t-2xs); color: var(--au-ink-4); font-style: italic; }
.au-scp-ext-count { color: var(--au-ink-4); font-size: var(--au-t-2xs); }

.au-scp-tree-row { display: flex; align-items: center; gap: var(--au-space-1); padding: var(--au-space-0-5) 0; }
.au-scp-tree-caret { flex: 0 0 auto; width: 12px; }
.au-scp-tree-name { flex: 1; min-width: 0; font: var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); overflow-wrap:anywhere; white-space:normal; }
.au-scp-tree-name.dir { color: var(--au-accent-signal); }
.au-scp-tree-name.file { color: var(--au-ink-1); }
.au-scp-patin { display: flex; gap: var(--au-space-1-5); align-items: center; }

.au-scp-chips { display: flex; flex-wrap: wrap; gap: var(--au-space-1); }
.au-scp-hint { font-size: var(--au-t-2xs); color: var(--au-ink-4); margin-top: var(--au-space-1); }

.au-scp-resolved { display: flex; flex-direction: column; gap: var(--au-space-0-5); }
.au-scp-res-row { display: flex; gap: var(--au-space-1-5); align-items: center; font: var(--au-t-2xs) var(--au-font-mono); color: var(--au-ink-4); padding: var(--au-space-0-5) 0; }
.au-scp-res-tag { flex: 0 0 auto; font-size: var(--au-t-2xs); text-transform: uppercase; letter-spacing: var(--au-ls-label); color: var(--au-accent-signal); width: 30px; }
.au-scp-res-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.au-scp-res-none { color: var(--au-ink-4); font-style: italic; font-size: var(--au-t-2xs); }

.au-scp-effect { display:flex; flex-direction:column; gap:var(--au-space-2); }
.au-scp-actions { display: flex; align-items: center; gap: var(--au-space-2); }
.au-scp-status { font-size: var(--au-t-2xs); color: var(--au-ink-4); }
.au-scp-status.err { color: var(--au-color-danger); }
.au-scp-status.ok { color: var(--au-color-ok); }
/* Member navigation and editor have independent vertical scroll ownership. */
.au-scp { container-type:inline-size; display:flex; flex-direction:column; min-height:0; }
.au-scp-content { height:100%; min-height:0; box-sizing:border-box; padding:var(--au-space-5); gap:var(--au-space-3); }
.au-scp-top { display:flex; align-items:center; gap:var(--au-space-2); }
.au-scp-top h2 { font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-base) var(--au-font-sans); margin:0; flex:1; }
.au-scp-top [hidden] { display:none; }
.au-scp-intro { font-size:var(--au-t-sm); line-height:var(--au-lh-base); color:var(--au-ink-3); max-width:70ch; }
.au-scp-layout { display:grid; grid-template-columns:minmax(180px,.6fr) minmax(260px,1.4fr); min-height:0; flex:1; gap:var(--au-space-4); }
.au-scp-navigation,.au-scp-detail { min-width:0; min-height:0; }
.au-scp-member-browser { display:flex; flex-direction:column; gap:var(--au-space-3); min-width:0; min-height:0; }
.au-scp-navigation { flex:1; }
.au-scp-choose-member { display:none; align-self:flex-start; }
.au-scp-detail { border-left:1px solid var(--au-line-1); padding-left:var(--au-space-4); }
.au-scp-member { border:0; overflow:visible; }
.au-scp-member-heading { display:flex; flex-direction:column; gap:var(--au-space-2); }
.au-scp-member-heading h3 { margin:0; font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-base) var(--au-font-mono); overflow-wrap:anywhere; }
.au-scp-root { direction:ltr; white-space:normal; overflow-wrap:anywhere; text-align:left; font-size:var(--au-t-xs); }
.au-scp-body { padding:var(--au-space-4) 0; border:0; gap:var(--au-space-3); }
.au-scp-fieldhead { font-size:var(--au-t-xs); text-transform:none; letter-spacing:normal; color:var(--au-ink-2); margin:0; }
.au-scp-rule-text,.au-scp-res-path { white-space:pre-wrap; overflow-wrap:anywhere; direction:ltr; font-size:var(--au-t-xs); line-height:var(--au-lh-base); }
.au-scp-rule { align-items:flex-start; padding-block:var(--au-space-1); }
.au-scp-status,.au-scp-hint,.au-scp-rules-empty { font-size:var(--au-t-xs); line-height:var(--au-lh-base); }
.au-scp-actions { flex-wrap:wrap; padding-block:var(--au-space-2); border-bottom:1px solid var(--au-line-1); }
@container (max-width:600px) {
  .au-scp-content { padding:var(--au-space-3); }
  .au-scp-choose-member { display:inline-block; }
  .au-scp-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
  .au-scp-member-browser { display:none; }
  .au-scp-choosing .au-scp-member-browser { display:flex; }
  .au-scp-choosing .au-scp-detail { display:none; }
  .au-scp-detail { border-left:0; border-top:1px solid var(--au-line-1); padding-left:0; padding-top:var(--au-space-3); }
}

`
