# LLM Guidance for Raw-Derived Reductions

These markdown files were derived from pages that did not match any known extraction schema, or from pages the user explicitly saved in Raw mode. Treat the markdown in this folder as the first-pass LLM input.

The untouched browser captures live in `../raw/` as MHTML files when Chrome could capture them. Use those source files only when you need audit-level fidelity, need to recover information missing from the reduced markdown, or are designing a better schema.

**Note:** If you see values starting with `~` (e.g., `~T1`, `~U3`), these are interned references. Look them up in `refs.txt` in the session root folder.

## What to extract

When processing raw-derived reductions, look for:
- **Product name / title** — the primary item being sold or described
- **Price** — current price, original price, discount percentage
- **Rating** — star rating and total review count
- **Key specifications** — dimensions, weight, materials, technical specs
- **Features** — bullet-point feature lists or selling points
- **Availability** — in stock, shipping estimates, delivery options
- **Brand / Manufacturer** — who makes or sells the item
- **URL / Identifier** — any product ID, SKU, or ASIN in the source URL

## Output format

Structure your extraction as a markdown table or key-value list, matching the format used in the `reduced/` folder for consistency.

## Proposing a new schema

If you see a consistent DOM pattern across multiple raw-derived reductions from the same domain, you can propose an extraction schema. Use the corresponding MHTML files in `../raw/` as source evidence when the markdown reduction is not enough. The schema format is JSON:

```json
{
  "domain": "example.com",
  "version": "1",
  "description": "What this schema extracts",
  "pages": {
    "pageName": {
      "urlPattern": "/path-segment",
      "description": "What type of page this matches",
      "container": "CSS selector for repeating containers (optional)",
      "fields": {
        "fieldName": {
          "selector": "CSS selector",
          "type": "text | textAll | attribute | exists",
          "attribute": "attr name (only for type: attribute)"
        }
      }
    }
  }
}
```

### Field types
- `text` — innerText of the first matching element, trimmed
- `textAll` — array of innerText from all matching elements
- `attribute` — value of an HTML attribute (specify which in `attribute` key, or use `@attrName` shorthand as the selector to read from the container itself)
- `exists` — boolean, true if selector matches at least one element

### Where to save
Save proposed schemas to `schemas/` in the page-save project directory, named `{domain}.json`. Add the filename to `extension/schemas/manifest.json` so the extension loads it on next restart.
