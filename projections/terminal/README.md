# Terminal

The projection renders a host-owned shell with xterm. Colors and text metrics follow the active theme;
the shell controls command execution, aliases and completions.

Terminal typography has discoverable projection tokens in the Theming projection:
`--au-terminal-font-size` follows the shared small text scale by default; override it to enlarge
terminal text independently. `--au-terminal-line-height` is a unitless multiplier (default 16/13),
clamped to at least 1 by the renderer. Both update the existing xterm and refit its grid without
restarting the shell. The token sheet is declared through `customTokenEntry`, so these controls
can be discovered before a terminal is mounted. Font family still follows `--au-font-mono`.

Settings → Terminal settings owns device defaults for font, size, line height, contrast, shell, prompt, scrollback and cursor. The live preview is a separate interactive shell using this same renderer; Start/Stop and Restart affect only its process. Hiding or closing the settings page stops the preview. Appearance edits use the shared theme draft and apply live; Save keeps them. Shell and prompt defaults apply to new terminals.

Right-click terminal output and choose Terminal settings for per-pane shell, prompt and scrollback overrides and the explicit restart action. Omitted fields inherit device defaults. Prompt choices:

| Preset | Prompt |
|---|---|
| Raw | `$` (`#` for root) |
| Minimal | Current folder and prompt marker |
| Compact Git | Current path/folder and local branch with tracked-change marker |
| Clean | Shortened path and local branch above a full input line |
| Context | Clean plus failure status, active virtual environment and slow-command duration |
| Use my existing prompt | Preserve the shell's configured prompt |

Clean is the default. Presets support zsh and bash; other shells retain their own prompts. Changing a
preset saves this pane's configuration. **Restart to apply** ends the current shell and its running
command before creating the new one. It does not inject prompt setup into a running program.

The host creates private startup adapters, loads user shell configuration and applies the app prompt.
Global shell files are not modified. Git checks are local, omit untracked files and never fetch. Branch
and path lengths are constrained for narrow panes. Git status is currently synchronous; unusually large
repositories need performance evaluation. Context timing in bash preserves an existing DEBUG trap by
not installing its own timer when such a trap exists. Failures and environment context still work.

Prompt paths/branches use ANSI bright black, mapped to theme ink-4; failure markers use ANSI red,
mapped to danger. Normal input inherits the terminal text color. No colored segment backgrounds or
special icon-font dependency. Programs choose their RGB colors; xterm may adjust foreground rendering to meet the configured contrast target.

Validation: `pnpm --filter app test` covers prompt startup, session ownership,
preference validation and profile saves. Separately verify live typography, Save/Revert and process cleanup in an isolated Electron preview.
Use Settings → Terminal settings to inspect the preview.

## Text contrast

`--au-terminal-minimum-contrast` defaults to 4.5; set it to 1 to disable xterm foreground adjustment (supported range 1–21). Explicit ANSI cell backgrounds keep their own colors. Dim text uses xterm's separate, lower contrast treatment.

The terminal stays transparent. Its visual adapter composites flat CSS ancestor backgrounds and supplies the resulting RGB reference to xterm with zero alpha. For native material, gradients or images, `--au-terminal-contrast-ground` supplies the reference instead; it defaults to `--au-color-surface-1`. Tune this token to the intended pane ground for such themes. This reference does not measure desktop/image pixels and does not guarantee contrast on arbitrary backgrounds.

Ancestor style/class changes update the presentation without replacing the terminal session. Background-only updates do not refit text. CSS animations, pseudo-elements, blend modes and arbitrary external backdrop changes are outside this flat-background resolver.
