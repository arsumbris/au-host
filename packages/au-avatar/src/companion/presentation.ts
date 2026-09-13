export const COMPANION_STYLE = `
  .companion-stage { position:relative; width:100%; height:100%; overflow:hidden; isolation:isolate; }
  .companion-stage.companion-roaming { position:fixed; inset:0; width:100vw; height:100vh; z-index:1000; pointer-events:none; }
  .companion-call-home { position:absolute; inset:0; z-index:1; display:grid; place-items:center; width:100%; height:100%; padding:0; border:0; border-radius:var(--au-radius-md,8px); background:transparent; color:var(--au-ink-3,#aaa); cursor:pointer; }
  .companion-call-home svg { width:28px; height:28px; fill:none; stroke:currentColor; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; opacity:0.65; transition:opacity var(--au-m-fast,160ms); }
  .companion-call-home:hover svg, .companion-call-home:focus-visible svg { opacity:1; }
  .companion-call-home:focus-visible { outline:2px solid var(--au-color-accent); outline-offset:-4px; }
  .companion-call-home:disabled { cursor:default; }
  .companion-call-home:disabled svg { opacity:0.35; }
  @media (prefers-reduced-motion:reduce) { .companion-call-home svg { transition:none; } }
  .companion-stage canvas { display:block; width:100%; height:100%; }
  .companion-stage canvas:focus-visible { outline:2px solid var(--au-color-accent); outline-offset:-4px; }
  .companion-bubble { position:absolute; pointer-events:none; transform:translateX(-50%);
    border-radius:12px; padding:7px 12px; background:var(--au-ink-1); color:var(--au-color-surface-1);
    font:500 13px/1.3 var(--au-font-sans); white-space:nowrap; }
  .companion-bubble[data-sleeping="true"] { background:transparent; color:var(--au-ink-3); padding:0; }
  .companion-sleep-letters { position:relative; display:block; width:32px; height:24px; }
  .companion-sleep-letters > span { position:absolute; left:0; top:0; font-weight:600; font-size:12px;
    animation:companion-sleep-drift 3s ease-in-out infinite; }
  .companion-sleep-letters > span:nth-child(2) { animation-delay:-1s; font-size:15px; }
  .companion-sleep-letters > span:nth-child(3) { animation-delay:-2s; font-size:18px; }
  @keyframes companion-sleep-drift {
    0% { opacity:0; transform:translate3d(0,8px,0) scale(0.8) rotate(-7deg); }
    22% { opacity:0.85; }
    70% { opacity:0.6; }
    100% { opacity:0; transform:translate3d(19px,-28px,0) scale(1.15) rotate(7deg); }
  }
  .companion-stage[data-reduced="true"] .companion-sleep-letters > span { animation:none; opacity:0.8; transform:none; }
  .companion-stage[data-reduced="true"] .companion-sleep-letters > span:nth-child(2) { left:10px; top:-4px; }
  .companion-stage[data-reduced="true"] .companion-sleep-letters > span:nth-child(3) { left:22px; top:-9px; }
  .companion-bubble [hidden] { display:none; }
  .companion-bubble[hidden] { display:none; }
  @media (prefers-reduced-motion:reduce) { .companion-sleep-letters > span { animation:none; } }
`
