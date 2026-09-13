// Adopt a HOST-owned CSS sheet at document level, as a constructable stylesheet.
//
// A constructable sheet (`adoptedStyleSheets`) is EXEMPT from the CSP `style-src`, so host chrome
// carries no raw `<style>` and the strict renderer policy needs no `'unsafe-inline'`. Use this for
// HOST surfaces (the overlay site, the toast / confirm / chooser / context-menu / preview chrome),
// whose classes are host-owned and global. It is NOT for a projection's component CSS — that goes
// through `host.styles.inject`, which `@scope`-wraps to the projection's mount root. Token
// DECLARATION sheets ride the same `adoptedStyleSheets` path (`token-sheets.ts`).
export function adoptHostSheet(css: string): () => void {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
  }
}
