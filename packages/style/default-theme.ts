// Shipped visual policy belongs to the style package. Existing device choices take precedence.
import palette from './themes/umbris.theme.css?raw'
import finish from './themes/flat-surfaces.css?raw'
export const defaultTheme = {
  id: 'shipped:umbris-flat',
  name: 'Umbris — Flat',
  css: `${palette}\n${finish}`,
}
