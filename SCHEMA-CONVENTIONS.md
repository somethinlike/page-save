# Schema Development Conventions

This document is for AI assistants helping users create, update, or debug page-save extraction schemas. Read this before writing or modifying any schema.

## What page-save Does

page-save extracts structured data from web pages for AI consumption. A human opens browser tabs, selects them in the sidebar (or uses CLI), and page-save extracts product data, comments, or other structured content using domain-specific CSS selector schemas. The output is token-optimized: TSV tables for repeating items, compact key-value pairs for single items, with a reference table (`refs.txt`) for deduplication.

## Schema Architecture

### File Locations
- **Source of truth:** `schemas/{domain}.json` — JSON files in the project root
- **Extension copy:** `extension/schemas/{domain}.json` — identical copies loaded by Chrome
- **Built-in fallback:** `extension/extractors.js` → `BUILTIN_SCHEMAS` array — hardcoded JS objects that load even if JSON fetch fails
- **Manifest:** `extension/schemas/manifest.json` — lists all JSON schema filenames

When creating or updating a schema, **all three locations must be updated**: the JSON source file, the extension copy, and the built-in array in `extractors.js`. The extension must be reloaded in `chrome://extensions` after any change.

### Schema Format

```json
{
  "domain": "example.com",
  "version": "1",
  "description": "What this schema extracts",
  "pages": {
    "pageName": {
      "urlPattern": "/path-that-identifies-this-page-type",
      "description": "What type of page this is",
      "container": "CSS selector for repeating item wrappers (omit for single-item pages)",
      "scrollDepth": "none | full | pages:N",
      "urlRewrite": { "from": "example.com", "to": "alt.example.com" },
      "fields": {
        "fieldName": {
          "selector": "CSS selector",
          "type": "text | textAll | attribute | exists",
          "attribute": "attrName (only for type: attribute with CSS selector)"
        }
      }
    }
  }
}
```

### Field Types
- **`text`** — `innerText` of the first matching element, trimmed. Use for titles, prices, single values.
- **`textAll`** — Array of `innerText` from all matching elements. Use for feature bullet lists.
- **`attribute`** — Value of an HTML attribute. Two forms:
  - `"selector": "@data-asin"` — shorthand, reads `data-asin` directly from the container element
  - `"selector": ".someClass", "attribute": "href"` — reads `href` from matched child element
- **`exists`** — Boolean. `true` if selector matches at least one element. Use for badges (Prime, free shipping).

### Page Properties

- **`urlPattern`** — Substring matched against the full URL. Must be specific enough to distinguish page types (e.g., `/s?` for Amazon search vs `/dp/` for product detail). The first matching page definition wins.
- **`container`** — CSS selector for repeating items. When present, extraction iterates all matches and extracts fields from each. When absent, fields are extracted from `document` (single-item page).
- **`scrollDepth`** — Controls pre-extraction scrolling for lazy-loaded content:
  - `"none"` (default): no scrolling. Use for server-rendered pages.
  - `"full"`: scroll to bottom, wait 2s for new content per scroll, max 30 scrolls. Use for infinite-scroll pages.
  - `"pages:N"`: scroll N viewport-heights. Use when you want partial lazy content.
- **`urlRewrite`** — Navigate the tab to a different hostname before extraction. The tab is restored to the original URL after extraction completes. Use when an alternative version of the site has a better DOM structure (e.g., `old.reddit.com`).

## How to Build a Schema for a New Site

### Step 1: Identify Page Types
Open the site and determine what page types users will extract:
- **Search/listing pages** — repeating product cards with titles, prices, ratings
- **Product/item detail pages** — single item with full specs, description, reviews
- **Discussion/comment pages** — post body + repeating comment items

### Step 2: Find the Container Selector
For repeating-item pages, find the CSS selector that matches each product card / comment / listing item:

1. Right-click a product card → Inspect Element
2. Look for a repeating parent element that wraps each item
3. Good candidates: `[data-item-id]`, `[data-testid="product-card"]`, `.product-item`, `li.search-result`
4. Verify: `document.querySelectorAll('your-selector').length` should return the number of visible items
5. Avoid selectors that match navigation items, ads, or recommendation carousels

### Step 3: Map Field Selectors
For each field you want to extract, find the CSS selector **relative to the container**:

1. In DevTools, select a container element
2. Use `$0.querySelector('candidate-selector')` to test selectors within it
3. Verify the selector returns the right text/value
4. Test on at least 3 different items to ensure consistency

### Step 4: Test the Schema
Use the CLI to test extraction:
```bash
page-save extract --tab <pattern>
```
Check the output in `saved-pages/sessions/*/reduced/` for data quality.

### Step 5: Add Post-Processing (if needed)
If extracted values need normalization (e.g., "4.6 out of 5 stars" → "4.6"), add a post-processor function in `extension/extractors.js` under `POST_PROCESSORS[domain]`. Post-processors run after extraction, before session writing.

## Quality Guidelines

These rules determine what data to extract and how to handle it. The goal is maximum utility for AI-assisted comparison shopping and research, with minimum token waste.

### Must Extract (never omit these)
- **Price** — current price, always. Original/list price if visible (for discount calculation).
- **Title / Product name** — full title. Use selectors that get the complete name, not just the brand (e.g., Amazon's `.a-text-normal` gets the full name, `h2 span` only gets brand).
- **Rating** — star rating as a number. Normalize "4.6 out of 5 stars" → "4.6" in post-processing.
- **Review/vote count** — as a plain number. Normalize "(21.3K)" → "21300", "(1,234)" → "1234".
- **Unique identifier** — ASIN, SKU, listing ID, product ID. Whatever the site uses to uniquely identify an item. Use `@data-attribute` shorthand on the container when available.
- **Comment/review body text** — full text of user-generated content. Never truncate comments, reviews, or discussion posts. This is primary content, not marketing filler.
- **Author/username** — for discussion and review content.

### Should Extract (include when available)
- **Brand / Manufacturer** — clean the value (strip "Visit the X Store" patterns).
- **Availability / Stock** — "In Stock", "Ships in 3-5 days", "Out of Stock".
- **Shipping info** — free shipping, Prime eligible, delivery estimate.
- **Condition** — New, Used, Refurbished (especially for eBay, marketplace sites).
- **Feature bullets** — truncate each to first sentence in post-processing. The first sentence captures the claim; the rest is marketing elaboration.

### Do Not Extract
- **Product descriptions** — long-form marketing paragraphs. These are almost entirely filler ("Fuel your fitness goals with..."). The feature bullets already capture the key claims. If a user needs the full description, they can open the product page.
- **Navigation elements** — sidebar filters, category trees, breadcrumbs, footer links.
- **Recommendation carousels** — "Customers also bought", "Sponsored products", "Similar items". These are noise for comparison shopping.
- **Ad / sponsored content** — sponsored product cards often have different DOM structure anyway. If they share the same container selector, they'll be included but are generally lower quality.
- **Tracking URLs** — strip to clean paths. Amazon URLs with `ref=`, `dib=`, `sprefix=` tracking → just `amazon.com/dp/{ASIN}`. Other sites: strip everything except search query parameters.

### Token Optimization Rules
These are applied automatically by the session writer, but schema authors should be aware:

1. **Reference table (interning):** Titles, URLs, and brand names that appear 2+ times across pages get replaced with `~T1`, `~U1`, `~B1` symbols. Full values stored in `refs.txt`. This means: don't worry about long titles — if they repeat, interning handles the token cost.

2. **Cross-page deduplication:** Same product (by ASIN/ID) appearing on multiple search pages is kept only once. The first occurrence wins. This means: extracting the same fields from every search result page is fine — dedup removes the duplicates automatically.

3. **Redundant column pruning:** When a unique ID exists (ASIN), derivable columns (URL) are dropped from output. Define this in `src/markdown-formatter.ts` → `REDUNDANT_FIELDS` map.

4. **Compact representations:** `Yes`/`No` → `Y`/`N`. Long column headers → short aliases (defined in `HEADER_MAP` in `markdown-formatter.ts`). Add new mappings when creating schemas with verbose field names.

5. **TSV output:** Repeating items render as tab-separated values, not markdown tables. No pipe separators, no alignment rows, no row numbers. This is the most token-efficient tabular format.

## Schema Patterns by Site Type

### E-commerce (Amazon, Walmart, Best Buy, etc.)
- Search page: container = product card, fields = title, price, rating, reviews, ID
- Product page: no container (single item), fields = title, price, rating, reviews, features, brand
- Post-processor: normalize rating text, review count, brand name, clean price format

### Marketplace (eBay, Etsy)
- Search page: container = listing card, fields = title, price, condition, seller
- Watch for promoted/sponsored cards mixed into results (same container class)

### Discussion (Reddit, forums)
- Post page: container = comment element, fields = author, body, score
- Use `urlRewrite` when an alternative version has better DOM (e.g., `old.reddit.com`)
- Set `scrollDepth: 'none'` if the alternative version is server-rendered
- **Never truncate comment body text** — this is the primary content

### Home Improvement / Specialty (Home Depot, Micro Center)
- These sites often have model numbers, SKUs, and stock status as important fields
- Price may be split across multiple elements (dollars + cents) — use a parent selector that captures both

## Common Pitfalls

1. **Sponsored items have different DOM** — Amazon's sponsored products use `/sspa/click` URLs instead of `/dp/` links. The container selector catches them, but field selectors may fail. The extraction engine skips items where all fields are null.

2. **Lazy-loaded content** — If search results or comments only partially render on load, add `scrollDepth: 'full'` or `'pages:N'`. Test by comparing item count with and without scroll.

3. **React/SPA sites with empty DOM shells** — Target, Costco, and similar React apps render product cards via portals or lazy hydration. The container may exist but be empty. Use `:has()` selectors or target the rendered content directly. Mark these schemas as `"status": "experimental"`.

4. **Sites that block automation** — Etsy, Cloudflare-protected sites may show CAPTCHAs. page-save uses `chrome.scripting.executeScript` in an isolated world, which bypasses CSP but not CAPTCHAs. If a site blocks extraction, it falls back to raw text.

5. **Schema staleness** — Sites update their DOM structure. When extraction starts returning null fields, the schema selectors need updating. Increment the `version` field when updating selectors so it's clear which version is active.

6. **Multi-profile Chrome** — If page-save is installed in multiple Chrome profiles, they race to connect to the same WebSocket server. Only one profile's extension can be active at a time. Disable the extension in profiles that don't need it.

## Adding a Post-Processor

Post-processors live in `extension/extractors.js` under `POST_PROCESSORS`. They run after CSS extraction and before session writing.

```js
POST_PROCESSORS['example.com'] = (item, url) => {
  // Normalize rating: "4.6/5" → "4.6"
  if (item.rating) {
    const m = item.rating.match(/([\d.]+)/);
    if (m) item.rating = m[1];
  }

  // Clean price: "Current price: $20.99" → "$20.99"
  if (item.price) {
    const p = item.price.match(/\$[\d,.]+/);
    if (p) item.price = p[0];
  }

  // Extract ID from URL for dedup
  const idMatch = url.match(/\/product\/(\d+)/);
  if (idMatch) item.productId = idMatch[1];

  return item;
};
```

Post-processors should:
- Normalize verbose text to compact values (ratings, review counts, prices)
- Clean brand names (strip "Visit the X Store" boilerplate)
- Extract IDs from URLs when not available as DOM attributes
- Truncate marketing text (features to first sentence)
- Never remove fields — only transform values

## Checklist for New Schemas

- [ ] JSON file created in `schemas/{domain}.json`
- [ ] Copied to `extension/schemas/{domain}.json`
- [ ] Added to `extension/schemas/manifest.json`
- [ ] Built-in added to `BUILTIN_SCHEMAS` in `extension/extractors.js`
- [ ] Post-processor added if normalization needed
- [ ] Tested with `page-save extract --tab <domain>`
- [ ] Output checked: all fields populated, no nulls on expected data
- [ ] Token efficiency checked: no tracking URLs, no marketing paragraphs
- [ ] Extension reloaded and verified
