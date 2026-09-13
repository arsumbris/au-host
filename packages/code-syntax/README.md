# Shared source languages

The `languages` registry in `src/index.ts` owns extension detection, Markdown fence aliases and parser factories for both Editor and Reader. Unknown names fall back to plain text. Highlighting never rewrites source.

To add a language:

1. Import its CodeMirror language package or an installed legacy stream parser.
2. Add one registry entry: canonical `id`, `extensions`, optional `aliases`/exact `filenames`, and a `create` factory.
3. Add a representative source-preservation/highlighting case to `src/index.test.ts` and run `pnpm --filter @arsumbris/code-syntax test`.

Prefer dedicated language packages where available. Legacy parsers provide syntax highlighting, not language-server completion, semantic analysis or guaranteed grammar validation. The existing SCSS/Less and JSONC/JSON5 mappings use their CSS/JSON base parsers; dialect-specific grammar support remains a separate extension.

Markdown delegates its frontmatter to YAML and its code fences back through this registry. Markdown fence recursion is deliberately excluded. Engine semantic types remain authoritative above the local syntax layer.
