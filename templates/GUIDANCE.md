# AI Guidance for Raw Pages

These pages did not match any known extraction schema. The full page text is preserved as-is for you to analyze.

## What to extract

When processing raw pages, look for:
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

If you see a consistent DOM pattern across multiple raw pages from the same domain, you can propose an extraction schema. The schema format is JSON:

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
