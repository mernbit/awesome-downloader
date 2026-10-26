# Release checklist

Public source and public binaries are separate release steps. Do not publish a
download asset just because a local package command succeeds.

1. Run `npm ci` and `npm test` on Windows x64.
2. Review the source diff and export for private data and proprietary material.
3. Verify third-party license notices and provide corresponding source and build
   material for the actual bundled GPL binaries (including their linked components).
   The FFmpeg commit alone is not a complete source bundle for its external libraries.
   Mirror required source archives alongside binary release assets. Record hashes.
   Review the yt-dlp executable's bundled components too if it is included.
4. `npm run dist` builds an unsigned per-user NSIS installer. Test it on a clean
   Windows machine without Node.js: install, launch, extension setup, native handoff,
   download with audio, completion, update, and uninstall.
5. `npm run dist:linux` builds unsigned Linux x64 tar.gz and AppImage previews.
   Test one on a clean Linux machine: launch, extension setup, native handoff and
   a real download. Real-browser validation on Linux is still open work; do not
   present the Linux preview as fully supported.
6. Publish a **prerelease** until the clean-machine checks and known limitations
   are documented. Attach installers, checksums, notices, and required source assets.
7. Never attach research, browser profiles, diagnostics with media URLs, or user data.
8. Enable repository Issues and private vulnerability reporting. Review incoming
   pull requests; contributors do not need write/admin access to submit them.

Current gates: GitHub authentication, dependency source-distribution audit,
clean-machine installer QA, and first release publication. Code signing and browser
store publication are not configured. Do not advertise them as available.
