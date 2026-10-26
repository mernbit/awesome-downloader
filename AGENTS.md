# Awesome Downloader — Agent Guide

## What this project is

Awesome Downloader is an **early Windows x64 Electron desktop app** with a Chrome/Edge browser extension that adds “Download this video” buttons to web videos and hands selected media to the desktop app over a local native-messaging bridge.

It is **not** a cross-platform release, not a full IDM replacement, and not a general video downloader for arbitrary sites. YouTube capture uses the browser’s captured session plus the `googlevideo` SABR transport library. A legacy yt-dlp path exists but is optional and is **not** used by the browser-capture flow.

Current stated targets: Windows 10/11 x64 Intel/AMD. Linux, macOS, Windows ARM64, broader browser support, and playlists are approved roadmap goals, not released capabilities.

## Quick orientation

```
package.json            ← npm scripts, electron-builder win targets, dependencies
desktop/main.cjs        ← Electron main process, app lifecycle, IPC handlers, menu, tray, bridge startup
desktop/preload.cjs     ← contextBridge API exposed to renderer and progress windows
desktop/browser-registration.cjs ← native messaging host registration, installed-browser discovery, .NET host build
desktop/browser-setup.cjs        ← opens Chrome/Edge extensions pages
desktop/progress-window.cjs      ← small helpers for progress dialog show/close behavior
desktop/resource-copy.cjs        ← copy-only-if-changed helper for startup resource deployment
renderer/app.js         ← renderer UI: list, selection, add/review, details, settings, scheduler, integration panel
renderer/index.html     ← renderer entry page (load from desktop/main.cjs)
extension/              ← bundled Chrome/Edge/Firefox extension source
core/                   ← Node download engine and media plumbing, runs in the main process
integration/            ← native messaging host (Node) and .NET launcher, plus packaging/deployment scripts
vendor/                 ← third-party license/notice files
tests/                  ← Node test suites for the core engine and download logic
docs/                   ← user install guide, browser distribution notes, contributor start guide, releasing checklist
```

## Architecture

### Three runtimes that must stay aligned

1. **Electron main process** — `desktop/main.cjs`
   - Owns the download engine, tray, menu, progress windows, IPC handlers, and local HTTP bridge.
   - Deploy the bundled extension and integration files out of ASAR at startup so browsers and native messaging can see real files.
   - Builds and registers the native messaging host at startup if missing.

2. **Renderer** — `renderer/app.js`
   - Sandboxed, uses the preload bridge only.
   - Displays download list state, handles selection/actions, dialogs, and the integration/browser-setup UI.

3. **Browser extension** — `extension/`
   - Detects video elements and page links, captures YouTube player responses, remembers observed media per tab, and sends download intents to the desktop through native messaging.
   - Has a separate Firefox manifest in `extension/manifest.firefox.json`; Firefox YouTube parity is explicitly not complete.

### Core subsystems

- **Download engine** — `core/engine.mjs`
  - Central state machine: `queued/paused/scheduled/probing/downloading/assembling/complete/error/cancelled`.
  - Persistence in `downloads.json`; temporary segmented downloads in `<data>/parts/<id>/`.
  - Ranged parallel HTTP downloads, pause/resume from partial files, HLS VOD, direct audio+video pairing, YouTube via SABR or legacy yt-dlp, and FFmpeg muxing/conversions to MP4/MP3.
- **HTTP layer** — `core/http.mjs`
  - Basic Node HTTP/HTTPS client with redirects, HEAD/probe fallback, range support, and validation helpers.
- **HLS** — `core/hls.mjs`
  - Master and media playlist parsing, variant selection, segment downloading, scoped header handling, and VOD-only support.
- **YouTube (legacy yt-dlp path + format resolution)** — `core/youtube.mjs`
  - URL canonicalization, format choice construction, rate-limit/verification error shaping, and yt-dlp invocation.
- **SABR** — `core/sabr.mjs`
  - Normalized YouTube SABR session handling and download via `googlevideo/sabr-stream`.
- **Muxing** — `core/mux.mjs`
  - FFmpeg-based track concatenation and format conversion.
- **Bridge** — `core/bridge.mjs`
  - Small loopback HTTP server that the extension/native host talks to. Token-authenticated and origin-locked to `127.0.0.1`.
- **Native host** — `integration/native-host.cjs` + `NativeHostLauncher.cs`
  - Chrome/Edge native messaging entry point; validates and forwards requests to the desktop bridge, with automatic desktop launch retry.

### Data and config locations

- App data is written under the user’s home directory by default:
  - `<home>/.awesome-downloader/` for shared data.
  - `downloads.json`, `parts/`, bridge config, and native messaging manifests live there depending on context.
- Browser integration files are deployed to a `BrowserIntegration` folder under that shared data directory at startup when packaged.

### Security model worth preserving

- IPC handlers verify that the caller frame belongs to a trusted window before acting.
- Bridge rejects non-loopback hosts and CORS-style origins; token auth is required.
- Native host strongly sanitizes SABR sessions, headers, filenames, URLs, and actions; it rejects DASH and unsafe fields.
- Credentials are kept in memory where possible and are not persisted in history or snapshots.
- Extension/tab state is isolated: requests, media cache, and SABR capture are scoped by tab.

## Repo shape and package scripts

- `npm start` — run Electron from source.
- `npm test` — run all detected test files.
- `npm run package` — build unpacked Windows app.
- `npm run dist` — build a local unsigned NSIS installer.
- `npm run dist:portable` — build a portable exe.

Build config is Windows-only in `package.json` today. `electron-builder` targets, icons, and extra resources assume Windows.

## Key implementation details agents should know

- The main process is the source of truth for downloads and settings.
- There is one app instance by lock; a second instance raises the existing window.
- Downloads can be:
  - direct HTTP(S) files with segmented/ranged transfer when the server allows it,
  - HLS VOD playlists,
  - paired separate video+audio tracks,
  - YouTube either via SABR or via the optional yt-dlp legacy path,
  - SABR sessions are identified by video + quality/itag, not just by a temporary URL.
- FFmpeg is used for combining tracks and for MP3/MP4 conversion; binary paths are unpacked from ASAR at runtime.
- The extension relies on native messaging for desktop handoff; it also supports a popup UI and context-menu download actions.
- YouTube page support includes player response interception via `fetch`/`XHR` hooks in the page world and a relay from the page to the service worker.

## Testing

- Tests are Node-based and cover engine behavior, HTTP transfer integrity, pause/resume, scheduled history, bridge security, HLS, SABR normalization, yt-dlp error shaping, and extension message lifecycles.
- Several engine/HLS/mux tests spin up local HTTP fixtures and verify exact reconstructed bytes.
- Extension tests use a VM harness that stubs `browser/chrome` APIs.
- The test command runs all detected `*.test.mjs` and `*.test.cjs` files.

When adding or changing behavior, prefer regression tests for:
- transfer integrity and resume,
- authentication/origin/token checks,
- request sanitization in the native host,
- download lifecycle transitions,
- extension tab isolation and cleanup on invalidation/navigation.

## Development workflow

- Use Windows x64 with Node.js 22+ for development and packaging.
- Run `npm ci`, then `npm test`, then `npm start` for the normal loop.
- Packaging is Windows-only for now; do not assume `npm run package` or `npm run dist` produce Linux/macOS artifacts.
- Keep PRs focused and linked to an issue; the contributor guide spells out the label and dependency conventions.

## Platform reality check

If you are evaluating work on this repo, assume Windows-first. Any Linux/macOS/ARM work should go through the project’s shared-adapters plan rather than one-off per-platform copy/paste.

## Files worth reading first

- `desktop/main.cjs`
- `core/engine.mjs`
- `extension/background.js`
- `extension/content.js`
- `integration/native-host.cjs`
- `docs/CONTRIBUTOR-START-HERE.md`
- `docs/INSTALL.md`
