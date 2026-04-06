# Page Save — AI Browsing Assistant Output

This folder contains structured web page extractions created by [page-save](https://github.com/somethinlike/page-save), a Chrome extension + Node.js bridge that captures and reduces web content for AI consumption.

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
│       ├── reduced/       ← Pages with schema-based extraction (structured, minimal)
│       │   └── *.md       ← Markdown with tables or key-value product data
│       └── raw/           ← Pages without a matching schema (full text dump)
│           ├── GUIDANCE.md ← Instructions for processing raw pages
│           └── *.md       ← Full innerText of the page
```

## How to read sessions

1. **Start with `manifest.json`** — it lists every page, its type (structured/raw/error), source URL, and output file
2. **Read `reduced/` first** — these are pre-processed. Product data is already in tables or key-value format. Minimal tokens.
3. **Read `raw/` if needed** — these are full text dumps. Refer to `GUIDANCE.md` in the raw folder for extraction instructions.

## What "reduced" means

A **reduced** file was extracted using a domain-specific schema (e.g., `amazon.com.json`). The schema defines CSS selectors that target exactly the product data fields — title, price, rating, features — and ignores navigation, ads, recommendations, and tracking noise. A 42KB Amazon search page becomes a ~2KB markdown table.

## What "raw" means

A **raw** file is the full `document.body.innerText` of a page that had no matching schema. It includes everything — nav bars, sidebars, footers. You (the AI) should extract the relevant data following the instructions in `GUIDANCE.md`.

If you encounter multiple raw pages from the same domain with a consistent structure, consider proposing a new schema. See `GUIDANCE.md` for the schema format.

## Schemas

Extraction schemas live in the page-save project under `schemas/`. Each is a JSON file mapping CSS selectors to product data fields for a specific domain. Current schemas:

- `amazon.com.json` — Amazon search results and product detail pages

The `_template.json` file documents the schema format for creating new ones.
