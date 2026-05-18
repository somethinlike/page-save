# Page Save — LLM Browsing Assistant Output

This folder contains structured web page extractions created by [page-save](https://github.com/somethinlike/page-save), a Chrome extension + Node.js bridge that captures and reduces web content for LLM consumption.

## How it works

1. A human opens browser tabs (e.g., product searches, comparison shopping)
2. They select tabs in the page-save sidebar and click "Save"
3. page-save extracts content using domain-specific schemas where available
4. Output lands here, organized into timestamped sessions

## Folder structure

```
saved-pages/
├── README.md              ← You are here
├── sessions/
│   └── YYYY-MM-DD_HHmm/  ← One folder per save session
│       ├── manifest.json  ← Index of all pages in this session
│       ├── refs.txt       ← Symbol table (interned references)
│       ├── reduced/       ← LLM-readable markdown (schema output or reduced fallback)
│       │   ├── GUIDANCE.md ← Instructions for raw-derived reductions, when present
│       │   └── *.md       ← Markdown with compact tables, key-value data, or reduced text
│       └── raw/           ← Untouched browser source captures
│           └── *.mhtml    ← Browser Save Page As / MHTML capture when available
```

## How to read sessions

1. **Start with `manifest.json`** — it lists every page, its type (structured/raw/error), source URL, primary LLM-readable `file`, and any untouched `rawFile`
2. **Read `reduced/` first** — these are pre-processed. Product data is already in tables, key-value format, or clean fallback markdown. Minimal tokens.
3. **Open `raw/` only when fidelity matters** — these are source captures for auditing, schema work, or recovering information the reduction missed.

## What "reduced" means

A **reduced** file is the artifact intended for LLM consumption. The best case is a domain-specific schema (e.g., `amazon.com.json`) that targets exactly the relevant fields — title, price, rating, features — and ignores navigation, ads, recommendations, and tracking noise. A 42KB Amazon search page becomes a ~2KB markdown table.

When a page has no schema or the user explicitly chooses Raw mode, page-save still writes an LLM-readable reduction in `reduced/`: Defuddle-cleaned article markdown when possible, otherwise compact markdown from the page text.

## What "raw" means

A **raw** file is the untouched browser capture, equivalent to the browser's "Save Page As" MHTML output. It preserves the rendered page source and resources for auditability. It is not the first-pass LLM input because it is intentionally large and unreduced.

If you encounter multiple raw-derived reductions from the same domain with a consistent structure, consider proposing a new schema. See `reduced/GUIDANCE.md` for the schema format.

## Interned references (~symbols)

Values starting with `~` (tilde) in the markdown files are **interned references** — short symbols that replace long, repeated strings to reduce token usage. The full values are stored in `refs.txt` in the session root.

Prefixes: `~T` = product title, `~U` = URL, `~B` = brand name.

Example: `~T1` in a markdown table means "look up ~T1 in refs.txt to get the full product title." Only dereference when you actually need the full value — for comparison or summarization, the symbol itself is sufficient as a unique identifier.

If a session has no `refs.txt`, no interning was applied (all values are inline).

## Schemas

Extraction schemas live in the page-save project under `schemas/`. Each is a JSON file mapping CSS selectors to product data fields for a specific domain. Current schemas:

- `amazon.com.json` — Amazon search results and product detail pages

The `_template.json` file documents the schema format for creating new ones.
