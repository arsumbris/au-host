// Vendored glyph attribution and source records: third-party/feather-LICENSE and third-party/lucide-LICENSE in this package.
import clsx from 'clsx'
import type { ReactNode, SVGProps } from 'react'
import './Icon.css'

/**
 * The ONE inline-SVG surface for TYPE-SCALED glyphs: a fixed set of hand-picked 24×24 shapes
 * (thin 1.75 stroke, `currentColor`). No runtime dependency, no font, no sprite
 * sheet — the paths ship in this module so a projection bundle needs nothing extra.
 *
 * It is NOT the kit's only inline SVG, and the exception is a deliberate second alphabet: a control
 * that carries fixed chrome rather than an icon beside text — the Select / Combobox trigger, an
 * Accordion header, the Table caret, a grip, a close button — draws in a 16 box on a 1.5 stroke,
 * sized by its own CSS. Each of those shapes has exactly ONE owner (`ChevronGlyph`, `GripGlyph`,
 * `CloseButton`); a new glyph that is not control chrome belongs HERE.
 *
 * SIZING IS TOKEN-DRIVEN. The `<svg>` is `1em` square and its `font-size` is bound to the type ramp
 * via `[data-size]` in Icon.css, so an icon scales with the exact same tokens the text around it
 * uses — never a raw px. `color` is inherited, so an icon takes the ink of its context.
 */

/* Solid marks (dot/grip/more-*) carry an explicit fill. */
const GLYPHS = {
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  'chevron-up': <path d="m6 15 6-6 6 6" />,
  'chevrons-left': (
    <>
      <path d="m11 6-6 6 6 6" />
      <path d="m18 6-6 6 6 6" />
    </>
  ),
  'chevrons-right': (
    <>
      <path d="m6 6 6 6-6 6" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  swap: (
    <>
      <path d="m16 3 4 4-4 4" />
      <path d="M4 7h16" />
      <path d="m8 21-4-4 4-4" />
      <path d="M20 17H4" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  folder: <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />,
  'folder-open': (
    <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </>
  ),
  'file-text': (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.3" />
      <circle cx="9" cy="12" r="1.3" />
      <circle cx="9" cy="18" r="1.3" />
      <circle cx="15" cy="6" r="1.3" />
      <circle cx="15" cy="12" r="1.3" />
      <circle cx="15" cy="18" r="1.3" />
    </g>
  ),
  gear: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  forward: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  reload: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  play: <path d="m6 3 14 9-14 9Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  'external-link': (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  'more-horizontal': (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </g>
  ),
  'more-vertical': (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="19" r="1.3" />
    </g>
  ),
  'panel-left': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </>
  ),
  /* panel-right — the MIRROR of `panel-left`: the same 18-square inset 3 (rx 2), its divider moved to
   * the far side (x=15, six units in from the right edge, exactly as panel-left's x=9 is six in from the
   * left). One glyph reads "toggle the primary/left rail", the other "toggle the secondary/right rail";
   * they differ only in which edge the thin panel sits against, which is the whole information they carry. */
  'panel-right': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </>
  ),
  /* split-right / split-down — the SAME construction as `panel-left` (one 18-square inset 3, rx 2,
   * one full-length divider), moved to the middle. panel-left's divider sits off-centre at x=9
   * because a rail is narrow; a split divider is centred because a split halves the slot. So the
   * three read as one family and differ only where the line falls, which is exactly the information
   * they carry. The AXIS names the direction the new pane appears in: `split-right` opens beside
   * (vertical divider), `split-down` opens below (horizontal divider). */
  'split-right': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </>
  ),
  'split-down': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 12h18" />
    </>
  ),
  /* maximize — four corner brackets, each turned with the same `a2 2 0` corner arc the rect glyphs
   * get from `rx="2"`. No box outline: the absent edges are what says "grow to fill". */
  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  /* pop-out — detach into its own window: an open outer frame with a smaller inset one riding its
   * bottom-trailing corner. DELIBERATELY not `external-link` (a box with a diagonal arrow leaving
   * it): that mark means "this goes somewhere else", while a detached pane stays the same surface
   * and only changes which window holds it. Two verbs, two glyphs. */
  'pop-out': (
    <>
      <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <rect width="10" height="7" x="12" y="13" rx="2" />
    </>
  ),
  /* lock — the shackle is an open arc closing onto the body's top edge, so the two meet flush at
   * y=11 and the join reads as one mark rather than a hoop parked on a box. */
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>
  ),
  warning: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  'alert-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  /* sun — the LIGHT-theme mark: a stroked disc with eight rays. The disc is stroked (not filled like
   * `dot`) so it reads as the same thin-stroke alphabet as the rest of the family; the rays are the
   * eight compass points, each a short segment clear of the disc. Pairs with `moon` for a light ↔ dark
   * theme mark, which is why the two share this stroke weight and 24-box. */
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  /* moon — the DARK-theme mark: the crescent as ONE closed path (a disc with a second disc subtracted
   * along its leading edge), so it carries a single stroke like `sun` rather than two stacked arcs. */
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof GLYPHS

export const ICON_NAMES = Object.keys(GLYPHS).sort() as IconName[]

export type IconSize = 'xs' | 'sm' | 'md' | 'lg'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /* Token-bound box: xs/sm/md/lg map to the type ramp (12/16/20/28) via Icon.css. A raw number is
   * an ESCAPE HATCH — it sets `font-size` inline in px. */
  size?: IconSize | number
  /** Omitted → `aria-hidden`: decorative is the default. */
  title?: string
}

export function Icon({ name, size = 'md', title, className, style, ...rest }: IconProps) {
  const numeric = typeof size === 'number'
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx('au-icon', className)}
      data-size={numeric ? undefined : size}
      style={numeric ? { fontSize: size, ...style } : style}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {GLYPHS[name]}
    </svg>
  )
}
