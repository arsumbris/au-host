/** Shared floating material declarations; consumers own positioning, shape and shadow. */
export const floatingSurfaceMaterialCSS = `
  isolation: isolate;
  background: color-mix(in srgb, var(--au-floating-fill, var(--au-elev-5-fill, #232323)) calc(var(--au-surface-alpha, 1) * 100%), transparent);
  background-image: var(--au-floating-background-image, none);
  backdrop-filter: var(--au-material-filter, none);
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background-image: var(--au-floating-edge-image, none);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    pointer-events: none;
    z-index: var(--au-z-raised);
  }
  @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
    background: var(--au-floating-fill, var(--au-elev-5-fill, #232323));
    &::before { display: none; }
    backdrop-filter: none;
  }
`
