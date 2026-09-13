export const SPHERE_STYLE = `
  .au-avatar-stage { position: absolute; inset: 0; overflow: hidden; background: transparent; }
  .au-avatar-stage > canvas { display: block; width: 100%; height: 100%; }
  .au-avatar-zzz {
    position: absolute; top: calc(50% - 40px); left: calc(50% + 22px); pointer-events: none;
    font-family: ui-rounded, "SF Pro Rounded", system-ui, sans-serif; font-weight: 700; color: var(--au-ink-3);
  }
  .au-avatar-zzz span { position: absolute; opacity: 0; animation: au-avatar-float 3.2s ease-in-out infinite; }
  .au-avatar-zzz span:nth-child(1) { font-size: 14px; animation-delay: 0s; }
  .au-avatar-zzz span:nth-child(2) { font-size: 19px; animation-delay: 0.5s; }
  .au-avatar-zzz span:nth-child(3) { font-size: 25px; animation-delay: 1s; }
  @keyframes au-avatar-float {
    0%   { opacity: 0; transform: translate(0, 0) rotate(-6deg); }
    18%  { opacity: 0.85; }
    70%  { opacity: 0.85; }
    100% { opacity: 0; transform: translate(20px, -46px) rotate(10deg); }
  }
  @media (prefers-reduced-motion: reduce) { .au-avatar-zzz span { animation-duration: 6s; } }
`
