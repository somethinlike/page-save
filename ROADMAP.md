# Page-Save Competitive Feature Roadmap

## Context
Competitive analysis of scraping products and AI-optimized content tools identified features that would strengthen page-save's position as an AI-optimized content preprocessor. None of these competitors optimize output for AI token consumption — page-save's core differentiator (symbol interning, reference tables, dedup, TSV formatting). These features add extraction quality, new content types, UX polish, and automation while keeping the AI-token-optimization focus.

Key competitors analyzed: Thunderbit, Instant Data Scraper, Browse AI, Deep Scraper, Octoparse, PandaExtract, Simplescraper, Web Scraper, LLMFeeder, Markdownload, web2md, Obsidian Web Clipper, mcp-chrome, Defuddle, Firecrawl, Crawl4AI, markdownify-mcp.

## Dependency Graph
```
Phase 1  (Confidence) ──── independent, zero risk
Phase 2  (Pagination) ──── independent, enables Phase 4 patterns
Phase 3  (Schema Suggest) ── independent
Phase 4  (Batch URLs) ──── benefits from Phase 2 tab lifecycle patterns
Phase 5  (Defuddle) ─────── independent, improves raw fallback quality
Phase 6  (YouTube) ──────── independent, new extractor type
Phase 7  (MCP Server) ──── wraps Phases 1-6 as native AI tools
Phase 8  (Price Watch) ──── requires Phase 4 (batch URL extraction)
Phase 9  (Session Accum.) ── independent, workflow change
Phase 10 (Preview/Edit) ── independent, pairs with Phase 9
Phase 11 (Delta Mode) ──── requires Phase 8 (diff engine)
Phase 12 (More Schemas) ── parallel, ongoing, uses Phase 3
```

---

## Phase 1: Confidence Scores Per Field

**Value:** Diagnose broken selectors instantly. When a schema starts returning nulls, confidence scores surface it without manual inspection.

**What:** After extraction, compute per-field population rates (populated vs null counts). Output in manifest.json.

**Files:**
- `src/session-writer.ts` — add `computeConfidence(results)`, call between dedup and interning, pass to `writeManifest()`
- `src/types.ts` — add `FieldConfidence` and `PageConfidence` interfaces
- manifest.json gains a `confidence` key with per-domain/pageType breakdown

**Output example in manifest.json:**
```json
"confidence": [{
  "domain": "amazon.com", "pageType": "search",
  "fields": [
    { "field": "title", "total": 48, "populated": 48, "rate": 1.0 },
    { "field": "price", "total": 48, "populated": 43, "rate": 0.896 }
  ],
  "overallRate": 0.94
}]
```

**No new CLI commands.** Auto-generated with every extraction session.

---

## Phase 2: Pagination Auto-Follow

**Value:** Eliminates the biggest UX friction — users currently open 7 search page tabs manually. One tab → all pages extracted.

**What:** Schema property `pagination` with a CSS selector for the "next" link. Extraction loop follows pagination automatically.

**Schema change:**
```json
"pagination": {
  "selector": ".s-pagination-next",
  "maxPages": 10,
  "waitStrategy": "navigation"
}
```
`waitStrategy`: `"navigation"` (full page load, traditional sites) or `"mutation"` (SPA, DOM update without navigation).

**Files:**
- `extension/extractors.js` — add `extractWithPagination(tabId, url, maxPages)` function. Uses existing `navigateAndWait()` for page transitions.
- `extension/service-worker.js` — add `get-structured-paginated` action handler
- `src/server.ts` — add `extract-pages` CLI command with `--max-pages` flag. Make `sendToExtension()` timeout configurable (currently hardcoded 15s, needs `maxPages * 15000` for pagination).
- `src/types.ts` — extend `WsRequest` with `maxPages` field
- `schemas/amazon.com.json` — add pagination selector (`.s-pagination-next`)

**New CLI command:** `page-save extract-pages --tab <pattern> [--max-pages 10]`

**Integration:** Returns `ExtractionResult[]` → `writeSession()`. Cross-page dedup handles duplicate products across pages automatically.

---

## Phase 3: Schema Suggest Command

**Value:** AI or user points at any page, gets a draft schema proposal. Accelerates schema creation from hours to seconds.

**What:** New CLI command that probes a page's DOM structure, identifies repeating patterns, and outputs a draft schema JSON.

**Files:**
- `extension/extractors.js` — add `probeDomStructure()` function. Injected script that:
  1. Counts `tagName.className` frequency across all elements
  2. Identifies candidates with 3+ occurrences (likely product cards)
  3. Samples 3 elements from top candidates, records child structure
  4. Detects price-like text (`$X.XX`), rating patterns, heading/link text
  5. Returns candidates with sample field mappings
- `extension/service-worker.js` — add `probe-dom` action
- `src/schema-suggest.ts` — NEW module. Takes probe results, scores candidates, generates schema JSON following existing format
- `src/server.ts` — add `schema-suggest` CLI command with `--save` flag
- `src/types.ts` — add `DomProbeResult` interface

**New CLI command:** `page-save schema-suggest --tab <pattern> [--save]`

**Output:** Draft schema JSON to stdout, or written to `schemas/{domain}.json` with `--save`.

---

## Phase 4: Batch URL Scraping

**Value:** Extract from a list of URLs without opening tabs manually. Enables scripted/automated extraction workflows. Prerequisite for monitoring.

**What:** Extension opens background tabs, extracts, closes them. No manual tab management needed.

**Files:**
- `extension/service-worker.js` — add `batch-urls` action. For each URL: `chrome.tabs.create({ url, active: false })` → wait for load → `extractStructured()` → `chrome.tabs.remove()`. Concurrency limit of 3.
- `src/server.ts` — add `batch` CLI command with `--file` and `--urls` flags. Extended timeout: `urls.length * 20000`ms.
- `src/types.ts` — add `urls?: string[]` to `WsRequest`

**New CLI command:**
```
page-save batch --file urls.txt
page-save batch --urls "https://amazon.com/dp/B00E9M4XFI,https://amazon.com/dp/B00GL2HMES"
```

**Integration:** Returns `ExtractionResult[]` → `writeSession()`. Same pipeline.

---

## Phase 5: Defuddle Fallback Engine

**Value:** Raw text extraction (`document.body.innerText`) produces noisy output — nav bars, ads, sidebars, footers all included. Defuddle extracts main article content only, dramatically improving quality for domains without schemas.

**What:** Replace the raw text fallback path with Defuddle-powered extraction. When no schema matches, send raw HTML to the Node.js server, parse with `linkedom` (lightweight DOM), run Defuddle, output clean markdown.

**Why Node.js side, not extension side:** Defuddle requires a DOM. Service workers have no DOM. Injecting Defuddle's browser bundle into content scripts would require a build step. Running it server-side with `linkedom` avoids adding build complexity to the extension.

**Files:**
- `src/defuddle-extractor.ts` — NEW module. `extractWithDefuddle(html: string, url: string): string`. Parses HTML with `linkedom`, runs Defuddle with `{ markdown: true }`, returns clean content.
- `src/session-writer.ts` — route raw results through Defuddle before writing to `raw/` folder
- `src/types.ts` — extend `RawResult` with optional `html` field (extension sends HTML alongside text)
- `extension/service-worker.js` — when no schema matches, capture `document.documentElement.outerHTML` in addition to `innerText`
- `package.json` — add `defuddle` and `linkedom` dependencies

**New dependencies:** `defuddle`, `linkedom`

**No new CLI commands.** Transparent improvement to existing `extract`, `extract-all`, and sidebar save flows.

---

## Phase 6: YouTube Subtitle Extraction

**Value:** YouTube is one of the most common research sources. Extracting subtitles as clean text makes video content AI-consumable without manual transcription.

**What:** Detect YouTube tabs, extract video ID, fetch subtitles via YouTube's timedtext API, format as session markdown with video metadata.

**Files:**
- `src/youtube-extractor.ts` — NEW module. `extractSubtitles(videoId: string): Promise<YoutubeResult>`. Fetches timedtext XML, parses into plain text with timestamps. Falls back to auto-generated captions if manual captions unavailable.
- `src/session-writer.ts` — add YouTube result type handling, route to `reduced/` folder with `youtube.com-{videoId}.md` naming
- `src/types.ts` — add `YoutubeResult` interface: `{ videoId, title, channel, duration, language, transcript: string }`
- `extension/service-worker.js` — detect YouTube URLs (`youtube.com/watch`, `youtu.be/`), extract video ID, send as new action `get-youtube-transcript`
- `src/ws-handler.ts` — handle `get-youtube-transcript` action, call `extractSubtitles()`, return result

**New dependency:** `youtube-caption-extractor` (or direct timedtext API fetch — evaluate at implementation time)

**New CLI command:** `page-save youtube --tab <pattern>` (extracts transcript from a YouTube tab)

**Output example:**
```markdown
# Video: How Transformers Work — 3Blue1Brown
- Channel: 3Blue1Brown
- Duration: 26:14
- Language: en (auto-generated)

[00:00] Let's talk about how transformer models actually work...
[00:15] The key insight is the attention mechanism...
```

---

## Phase 7: MCP Server Integration

**Value:** Page-save tools appear natively in Claude Desktop, Claude Code, and any MCP client. No Bash wrapping, structured params/responses.

**What:** New entry point using `@modelcontextprotocol/sdk` stdio transport. Wraps all CLI commands as MCP tools.

**Files:**
- `src/mcp-server.ts` — NEW entry point. MCP tools:
  - `list_tabs` — no params, returns tab list
  - `extract` — params: `tab` (string), returns session + preview
  - `extract_all` — params: `domain` (string), returns session + counts
  - `extract_pages` — params: `tab`, `maxPages`, returns session
  - `batch_urls` — params: `urls` (string[]), returns session
  - `schema_suggest` — params: `tab`, returns draft schema
  - `youtube_transcript` — params: `tab` (string), returns transcript
- `src/server.ts` — refactor client connection into reusable `sendCommand()` export
- `bin/page-save-mcp.js` — shim entry point
- `package.json` — add `@modelcontextprotocol/sdk` dependency, `mcp` script, bin entry

**Architecture:**
```
Claude Desktop ──stdio──► MCP Server ──ws://7224──► Node.js Server ──ws──► Chrome Extension
```

---

## Phase 8: Monitoring / Price Watch

**Value:** "Watch this product and alert me when the price drops." Huge for comparison shopping. Pairs with scheduled tasks.

**What:** Save watch configurations (URL + fields to track), re-extract on demand, diff against previous snapshot, report changes.

**Files:**
- `src/diff.ts` — NEW module. `diffItems(prev, curr, keyField)` returns `{ added, removed, changed, unchanged }`. `diffSingleItem(prev, curr)` for product detail pages.
- `src/watch.ts` — NEW module. Watch CRUD: `createWatch(url)`, `runWatch(id)`, `listWatches()`. Storage: `saved-pages/watches/{id}/config.json`, `watches/{id}/snapshots/`, `watches/{id}/changes.json`
- `src/server.ts` — add CLI commands: `watch-add`, `watch-run`, `watch-list`
- `src/types.ts` — add `WatchConfig`, `DiffResult` interfaces

**New CLI commands:**
```
page-save watch-add --url <url> [--fields price,rating]
page-save watch-run [--id <watchId> | --all]
page-save watch-list
```

**Depends on:** Phase 4 (uses Batch URLs to extract single URL without manual tab).

---

## Phase 9: Multi-Page Session Accumulation

**Value:** Currently each extraction creates a new session. Researchers often navigate across multiple pages (article → references → related work) before they have a complete picture. Accumulation mode lets users build up a session incrementally, then finalize it as one coherent package.

**What:** New session lifecycle — open → add pages → finalize. Session stays open while the user navigates and triggers "add to session" for each relevant page. Manifest and refs.txt written at finalize.

**Files:**
- `src/session-writer.ts` — add `openSession(): string` (returns session ID), `appendToSession(sessionId, results)`, `finalizeSession(sessionId)`. Existing `writeSession()` becomes the "one-shot" path (still available).
- `src/types.ts` — add `SessionState` interface: `{ id, dir, pages: ExtractionResult[], startedAt }`
- `src/ws-handler.ts` — add `start-session`, `add-to-session`, `finalize-session` actions. Track active session in server state.
- `extension/sidepanel.js` — add "Start Session" / "Add to Session" / "Finalize" UI states. Show active session indicator with accumulated page count.
- `extension/sidepanel.html` — session control bar UI
- `extension/sidepanel.css` — session state styling

**New CLI commands:**
```
page-save session-start                    # Returns session ID
page-save session-add --tab <pattern>      # Add extraction to active session
page-save session-finalize                 # Write manifest, refs, close session
page-save session-status                   # Show active session info
```

---

## Phase 10: Sidebar Preview/Edit Before Save

**Value:** Users can't currently review extracted content before it's written to disk. A preview step lets users trim irrelevant sections, verify extraction quality, and catch schema errors before the data hits the AI pipeline.

**What:** After extraction but before writing, show the extracted content in the sidebar. Users review, toggle sections on/off, then confirm save.

**Files:**
- `extension/sidepanel.js` — add preview pane state. After extraction, render results as markdown preview instead of immediately sending to Node.js. Add per-section/per-item toggle checkboxes. "Save" button sends filtered results.
- `extension/sidepanel.html` — preview pane markup with section toggles and save/discard buttons
- `extension/sidepanel.css` — preview pane styling (markdown rendering, toggle states)
- `extension/service-worker.js` — new `preview-extraction` action that returns results to sidebar instead of forwarding to server. Existing `get-structured` path unchanged for CLI usage.

**No new CLI commands.** This is a sidebar-only UX enhancement. CLI extractions continue to write directly (no interactive preview needed when an AI is driving).

---

## Phase 11: Incremental Extraction (Delta Mode)

**Value:** On repeat searches, only show new or changed items. Saves tokens when monitoring a market over time.

**What:** Compare current extraction against a previous session, mark items as NEW/CHG/unchanged, optionally omit unchanged items.

**Files:**
- `src/diff.ts` (from Phase 8) — add `computeDelta(prevSessionDir, currentResults)`. Reads previous manifest + reduced files, matches by unique ID, returns delta annotations.
- `src/session-writer.ts` — add optional `deltaMode` to `writeSession()`. Annotates items with delta status before formatting.
- `src/markdown-formatter.ts` — when delta data present, prepend a `delta` column (NEW/CHG/empty)
- `src/server.ts` — add `--delta` and `--prev <session>` flags to `extract-all` and `extract-pages`

**Output:**
```
delta  asin        price   title
NEW    B0NEWPROD   $19.99  New Product Just Listed
CHG    B00E9M4XFI  $18.97  ~T1      (was $20.97)
       B00GL2HMES  $20.75  ~T2      (unchanged, included for context)
```

---

## Phase 12: More Schemas (Ongoing)

**Value:** More out-of-the-box coverage. Competitive tools ship with 40-469 templates.

**What:** Use SCHEMA-CONVENTIONS.md + Phase 3's `schema-suggest` command to rapidly build schemas for new domains.

**Priority targets:**
- Fix experimental: Target (React portals), Costco (MUI), Etsy (CAPTCHA)
- New retail: Lowe's, Sam's Club, Kroger
- Tech: PCPartPicker, Amazon (different country TLDs)
- General: Google Shopping (if DOM is inspectable), Craigslist, Facebook Marketplace

**No code changes needed** — uses existing schema infrastructure. Each new schema: JSON file + extension copy + manifest entry + built-in in extractors.js + optional post-processor.

---

## Cross-Cutting: Configurable Timeout

Required before Phase 2. Change `sendToExtension()` in `src/ws-handler.ts` to accept `timeoutMs` parameter (default 15000). Pagination, batch, and YouTube commands need longer timeouts proportional to page/content count.

---

## Verification Plan

Each phase is independently testable:

1. **Confidence:** Extract Amazon tabs → check manifest.json for confidence block → verify rates match expected population
2. **Pagination:** Open one Amazon search tab → `extract-pages --tab amazon --max-pages 3` → verify 3 pages extracted from single tab
3. **Schema Suggest:** Open any unsupported site → `schema-suggest --tab <pattern>` → verify valid JSON schema output
4. **Batch URLs:** Create urls.txt with 3 Amazon product URLs → `batch --file urls.txt` → verify 3 product pages extracted
5. **Defuddle:** Open a non-schema site (news article, blog post) → `extract --tab <pattern>` → verify raw/ output contains clean article content (no nav, ads, sidebars) instead of full innerText dump
6. **YouTube:** Open a YouTube video with subtitles → `youtube --tab youtube` → verify transcript output with timestamps and video metadata
7. **MCP:** Configure in Claude Desktop → verify tools appear (including `youtube_transcript`) → call `extract` tool → verify session created
8. **Watch:** `watch-add --url <amazon-product>` → `watch-run --all` → verify snapshot saved → change tab price → `watch-run` → verify change detected
9. **Session Accumulation:** `session-start` → `session-add --tab <page1>` → navigate → `session-add --tab <page2>` → `session-finalize` → verify single session with both pages, manifest written at finalize
10. **Preview/Edit:** Open sidebar → select tabs → click "Save Selected" → verify preview pane appears with content → toggle off a section → click "Save" → verify saved content excludes toggled-off section
11. **Delta:** Extract creatine search → wait → re-extract with `--delta` → verify NEW/CHG annotations
12. **More Schemas:** Add new domain schema → extract → verify structured output matches schema fields
