# Page Save — LLM Browsing Assistant Output

This folder contains browser page captures and structured extractions created by [page-save](https://github.com/somethinlike/page-save), a Chrome extension + Node.js bridge built for LLM-assisted browsing.

## How it works

1. A human opens browser tabs (e.g., product searches, comparison shopping)
2. They select tabs in the page-save sidebar and click "Save"
3. page-save either captures Raw MHTML or extracts content using domain-specific schemas
4. Output lands here, organized into timestamped sessions

## Folder structure

```
saved-pages/
├── README.md              ← You are here
├── sessions/
│   └── YYYY-MM-DD_HHmm/  ← One folder per save session
│       ├── manifest.json  ← Index of all pages in this session
│       ├── refs.txt       ← Symbol table (interned references)
│       ├── reduced/       ← LLM-readable markdown from Full schemas or variants
│       │   └── *.md       ← Markdown with compact tables or key-value data
│       └── raw/           ← Untouched browser source captures
│           └── *.mhtml    ← Browser Save Page As / MHTML capture when available
```

## How to read sessions

1. **Start with `manifest.json`** — it lists every page, its type (structured/raw/error), source URL, primary `file`, and any `rawFile`
2. **Read `reduced/` for structured output** — Full schema and variant output is pre-processed into compact tables or key-value format. Minimal tokens.
3. **Open `raw/` for Raw-mode pages** — these are untouched source captures for auditing, schema work, or recovering the complete browser page.

## What "reduced" means

A **reduced** file is the artifact intended for LLM consumption. The best case is a domain-specific schema (e.g., `amazon.com.json`) that targets exactly the relevant fields — title, price, rating, features — and ignores navigation, ads, recommendations, and tracking noise. A 42KB Amazon search page becomes a ~2KB markdown table.

The **Full** schema is the broad extraction for a domain: every usable field the schema knows how to preserve. **Variants** are narrower use-case outputs derived from that schema, such as price-only, seller-focused, or title-only views.

## What "raw" means

A **raw** file is the untouched browser capture, equivalent to the browser's "Save Page As" MHTML output. It preserves the rendered page source and resources for auditability. Raw mode does not generate a reduced markdown fallback, and page-save never writes injected DOM HTML into `raw/` as a substitute for MHTML.

If a raw page has no `rawFile` in `manifest.json`, Chromium could not produce the MHTML capture. Check the page entry's `rawSourceError` before assuming the page saved successfully.

## Interned references (~symbols)

Values starting with `~` (tilde) in the markdown files are **interned references** — short symbols that replace long, repeated strings to reduce token usage. The full values are stored in `refs.txt` in the session root.

Prefixes: `~T` = product title, `~U` = URL, `~B` = brand name.

Example: `~T1` in a markdown table means "look up ~T1 in refs.txt to get the full product title." Only dereference when you actually need the full value — for comparison or summarization, the symbol itself is sufficient as a unique identifier.

If a session has no `refs.txt`, no interning was applied (all values are inline).

## Schemas

Extraction schemas live in the page-save project under `schemas/`. Each is a JSON file mapping CSS selectors to product data fields for a specific domain. Current schemas:

- `amazon.com.json` — Amazon search results and product detail pages
- `ebay.com.json` — eBay search result listings

The `_template.json` file documents the schema format for creating new ones.
