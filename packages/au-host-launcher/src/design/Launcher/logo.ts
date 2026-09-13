// Vector keeps the mark zero-port (source-consumed, no asset loader) AND resolution independent. It
// carries its own transparent ground, so do NOT reach for `mix-blend-mode: screen` to drop one —
// screen blows out the umbra crescents that give the orb its form.

import { orbSvg } from './orb'

export const AU_HP_LOGO_DATA_URI =
  'data:image/svg+xml;utf8,' + encodeURIComponent(orbSvg(256))
