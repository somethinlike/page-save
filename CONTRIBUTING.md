# Contributing to Page Save Bridge
<!-- added: 2026 May 22 19:08.4 -->

Page Save Bridge is public domain under [CC0 1.0](LICENSE). By contributing,
you agree that your contribution is also released under CC0.

## Schema Contributions

Schemas are the most useful contribution. If you make or improve a schema for a
website, please contribute it upstream so everyone gets better extraction.

Good schema pull requests include:

- the domain and page types covered
- what the schema extracts
- the files changed
- at least one public, non-authenticated sample URL used for testing
- a short note about any fragile selectors, A/B layouts, or post-processing

Do not upload private saved pages, authenticated captures, cookies, account
data, order history, inboxes, dashboards, or personal browsing output. If a
site requires login, describe the page shape and redact anything account
specific.

## Schema Files

When adding or updating a schema, keep these in sync:

- `schemas/{domain}.json`
- `extension/schemas/{domain}.json`
- `extension/schemas/manifest.json`
- `extension/extractors.js` if the domain needs a post-processor or built-in
  fallback entry

Read [SCHEMA-CONVENTIONS.md](SCHEMA-CONVENTIONS.md) before opening a schema PR.
It covers field naming, variants, selector fallbacks, token optimization, and
the quality checklist.

## Validation

For code changes, run:

```bash
npm run typecheck
npm run build
npm test
```

For schema changes, also reload the Chromium extension and run an extraction
against a representative tab:

```bash
page-save extract --tab <domain>
```

Check the newest `saved-pages/sessions/*/manifest.json` and `reduced/*.md` for
null-heavy output, tracking URLs, duplicated junk, and overly verbose fields.

## Security Reports

Do not open public issues for security vulnerabilities. Email
somethinlike@gmail.com with details.
