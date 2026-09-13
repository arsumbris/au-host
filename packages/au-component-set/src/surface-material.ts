import { css, unsafeCSS } from 'lit'
import { floatingSurfaceMaterialCSS } from '@arsumbris/style/surface-material'

/** Shared floating material. Alpha mixing uses rectangular sRGB to preserve the source hue. */
export const floatingSurfaceMaterial = css`position: relative; ${unsafeCSS(floatingSurfaceMaterialCSS)}`

/** Chromium otherwise composites sharp source pixels through blur over native window vibrancy.
 * Fragment filter references are tree-scoped: install in each material-rendering shadow root too.
 * Normalize the sampled alpha after the theme's blur; native chrome outside overlays is untouched.
 * https://github.com/electron/electron/issues/39529
 */
export function installBackdropMaterial(root: Document | ShadowRoot): void {
  if (root.getElementById('au-backdrop-material')) return
  const document = root.ownerDocument ?? root as Document
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.id = 'au-backdrop-material'
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
  svg.innerHTML = '<defs><filter id="au-backdrop-opaque" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter></defs>'
  if (root instanceof Document) root.documentElement.append(svg)
  else root.append(svg)
}
