# Page Save Bridge

## Purpose and architecture
Chromium extension plus a local Node.js WebSocket bridge. Raw saves preserve browser MHTML; domain schemas produce compact structured Markdown. Saved browsing data is private input, never repository fixtures.

- `extension/`: Manifest V3 service worker, sidebar, and injected extraction engine.
- `src/`: TypeScript CLI, bridge, session writer, formatter, and MCP entry point.
- `schemas/`: source schemas; identical copies live in `extension/schemas/`.
- Default save root: `~/Documents/saved-pages`; `PAGE_SAVE_DIR` overrides it. Bridge binds loopback port 7224.

## Verified setup and checks
Node.js 22.6+; installed runtime inspected on October 17, 2026: Node 24.14.1, npm 11.11.0. Dependencies are present in `node_modules/`.

```powershell
npm run typecheck
npm test
npm run build
node dist/cli.js serve
```

Vitest's worker/temporary-file operations can fail under the Codex sandbox. A task-local `TEMP`/`TMP` override alone did not resolve it; the original test command succeeded with scoped elevation. This is a verified temporary route, not a system repair. Use PowerShell `login:false` if the host profile reports `Get-AppxPackage` access denied.

## Constraints
- Preserve unrelated edits and local captures. Do not commit MHTML, browser data, credentials, authenticated pages, or real lyric text as fixtures.
- Service-worker and injected code remain plain JavaScript. TypeScript builds into `dist/`; check actual import conventions before changing them.
- Update schema source, extension copy, registry manifest, and built-in fallback together.
- Test selectors against real saved DOM and use synthetic HTML for committed regression fixtures.
- Ryan prohibited computer-use in the current Genius task. Work from saved files; do not control browser windows or edit browser profiles/extension storage.
- Reloading the installed extension remains a user action during this task. Offline replay does not prove the installed extension has loaded new code.

## Documentation and workflow
- Read `SCHEMA-CONVENTIONS.md` before schema changes.
- Read `.agents/skills/schema-development/SKILL.md` for repeatable schema work.
- `README.md`: setup, CLI, browser workflows, security overview.
- `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md`: contribution and access boundaries.
- `MANUAL-TESTS.md`: browser checks; `ROADMAP.md`: implemented history and remaining work.
- `docs/genius-schema.md`: Genius page types, observed selectors, variants, and verification limits.

The legacy shared Gemini-rule pointer has been retired from this guidance. Retain recovery files without invoking deprecated agents or maintaining parallel instruction variants.
