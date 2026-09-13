---
type: au.engine.readme::au-engine
tldr: Metadata-discovered previews for images, PDF, audio, video and HTML artifacts.
---
# Repo Overview

## What this is

Five projections in one package. Each type's `opens-meta` declares its supported extensions;
`projection-runtime-meta.export` selects a mount function from the registered default module.
The composition's viewer defaults choose between eligible projections (HTML source or preview,
for example). There is no host file-type routing table.

Images support fit, actual size, zoom, drag-to-pan and a transparency background. Audio/video
use native controls, playback speed and per-file playback state. PDF uses Chromium's built-in
viewer for pages, zoom, search, text selection and printing. HTML runs in an opaque sandbox
with scripts, local CSS/images and relative assets; it cannot access the host bridge, navigate
the app, open popups or submit forms. Remote dependencies are blocked. SVG renders as an image;
HTML and SVG offer source editing. Media never autoplays.

## How to use this

Build with `pnpm --filter @au-projections/media-viewers build`. Mount `image-viewer`, `pdf-viewer`,
`audio-viewer`, `video-viewer` or `html-viewer` from `media-viewers`, setting `file` to an engine file
reference. Configure extension defaults in the containing composition to select the preferred
renderer for each file type.

Image zoom/pan/background and media playback position/volume/speed persist in per-pane viewStore.
PDF interaction state is managed by the native viewer, not synchronized into the host viewStore.
HTML state belongs to its document and resets on reload. Codec support depends on Chromium;
an unsupported file reports an error and offers Open externally. MOV is a container, not a codec
guarantee. HEIC, TIFF, RAW, Office, archives and layered design formats need dedicated decoders.

## How to extend this

Add extensions to the relevant type's `opens-meta`; the open handler reads the same metadata,
so eligibility and handling cannot drift. A new renderer gets a type, a named mount export and
an implementation in `src/viewers.ts`. Add a composition default only when it should win over
other eligible viewers. Native byte transport lives in `app/src/main/asset-response.ts`;
HTML assets are constrained to the entry document's real directory, including symlink checks.
Do not add media-specific intent routing to the host.

## Document containment checks

HTML and PDF use a bounded document frame with the shared pane radius and outline. The iframe
owns document scrolling; artifact styles, including fixed and sticky positioning, remain within
its viewport. The frame does not recolor or rewrite the artifact itself. HTML retains the existing
`allow-scripts` sandbox and `no-referrer` policy.

Run
`node projections/media-viewers/tests/document-containment.mjs` from the repository root for
isolated headless checks at 280px, 320px and 900px. This tests layout and interaction containment;
it does not certify native PDF controls or replace real-host asset security tests.
