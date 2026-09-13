# Settings hub

Settings keeps navigation beside host-mounted settings pages. Each child retains its own capability
and persistence owner; `children.mount` supplies its host context. Visited pages stay mounted while
hidden so navigation preserves drafts and scroll position. All handles are disposed when the hub
closes or a destination disappears from discovery.

`surfaces` is an ordered list of bare or qualified installed projection identities. Defaults are
Appearance, Workspace and Daemon, with titles read from presentation metadata. Ambiguous, missing
and duplicate identities are omitted. Discovery refreshes live. Search matches page titles and
identities, not undisclosed fields inside other projections. Escape clears search. Narrow panes
replace the sidebar with the shared page picker. The existing ambient intent opens a separate pane.

No second preference store, daemon behavior or session behavior is introduced. Search across
individual settings and projection-owned contributions still need their declared contract.
