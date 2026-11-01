---
name: schema-development
description: Add or repair Page Save domain extraction schemas using saved page captures and synthetic DOM regression tests.
---

# Page Save schema development

Read the project `AGENTS.md` and `SCHEMA-CONVENTIONS.md`. Source schemas live in `schemas/`; update their extension copies, `extension/schemas/manifest.json`, and `BUILTIN_SCHEMAS` in `extension/extractors.js` together.

Ground selectors in actual saved page structures. Decode the main HTML MIME part of MHTML without executing captured scripts or fetching resources. Keep private captures and real lyric text outside the repository. Use synthetic HTML with the observed structure in committed tests; `src/genius-extractors.test.ts` demonstrates real CSS queries through linkedom and the actual injected extractor in a VM.

For repeating records, keep title and canonical identity from the same container. Use recognized `itemId` identifiers to avoid title-only session deduplication. Add `scope: "page"` for header context where needed. Use optional required fields only for core content and verify every variant; projections must not require fields they omit. Read `docs/genius-schema.md` only for Genius-specific selectors and boundaries.

For recipe pages, select one responsive ingredient list with ordered fallbacks; never concatenate desktop, tablet, mobile and print duplicates. Keep quantities, preparation notes and complete ordered instructions. If sibling headings or paragraph blocks would concatenate in cloned text, use the inspected `lineBreakBefore` boundaries and test the resulting text. Read `docs/atk-schema.md` only for ATK layouts and coverage limits. Replay any retained print fallback separately, including optional time/yield metadata.

Verify source/extension/built-in registration, supported and unsupported URL routes, required-content failures, text preservation, unchanged source DOM and unrelated-domain behavior. Run `npm test`, `npm run typecheck`, and `npm run build` after implementation. Record any runtime restriction and verified temporary route in project guidance.

After pushing, inspect hosted CI for the pushed commit, including both push and pull-request runs; local success does not establish hosted success. See `docs/ci-verification.md` for verified commands and the Windows LF/CRLF source-boundary regression.

Offline replay verifies selectors against snapshots. Installed-extension reload and live extraction are separate checks; respect the user's current browser-interaction constraints and report any unperformed checks. Contribute the schema according to project guidance without uploading private captures or credentials.
