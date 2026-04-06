# Page Save v2 — ROADMAP

## Problem Statement
Amazon and similar shopping sites produce 40-400KB of text per page, but only ~2KB is useful product data. MCP browser tools completely fail on Amazon (DOM too large). Page-save v1's `text` command works but dumps everything (42KB including nav, ads, recommendations). We need domain-specific extraction that reduces token usage by 95%+.

## Architecture
See CLAUDE.md for full architecture diagram. Key components:
- **Schema system**: JSON files mapping CSS selectors to product fields per domain
- **Extraction engine**: Runs in Chrome's isolated world via `chrome.scripting.executeScript`
- **Session writer**: Timestamped folders with reduced/raw split + AI guidance
- **Sidebar UI**: Chrome Side Panel for mass tab selection and saving
- **CLI**: `extract` and `extract-all` commands for automation

## Implementation Phases

### Phase 1: Schema System + Structured Extraction [DONE]
- [x] Schema JSON format defined (`schemas/amazon.com.json`, `_template.json`)
- [x] Extraction engine (`extension/extractors.js`) — generic CSS selector → structured data
- [x] Service worker actions: `get-structured`, `get-structured-batch`
- [x] Updated types (`src/types.ts`)

### Phase 2: Session Folder Structure + Output [DONE]
- [x] Session writer (`src/session-writer.ts`) — timestamped folders, reduced/raw split
- [x] Markdown formatter (`src/markdown-formatter.ts`) — tables for search results, key-value for products
- [x] Master README auto-generation on first session
- [x] GUIDANCE.md template for raw folders

### Phase 3: Chrome Sidebar UI [DONE]
- [x] Side Panel manifest config
- [x] Tab list grouped by domain, sorted by count
- [x] Checkboxes per tab + "Select All" per domain
- [x] Schema indicator badges (green/yellow)
- [x] Save button → batch extraction → progress feedback
- [x] Service worker message handlers for sidebar communication

### Phase 4: AI Guidance System [DONE]
- [x] `templates/SAVED-PAGES-README.md` — master system prompt
- [x] `templates/GUIDANCE.md` — raw folder processing instructions + schema proposal format
- [x] Updated CLAUDE.md with full v2 architecture

### Phase 5: CLI Updates [DONE]
- [x] `extract --tab <id|pattern>` — single tab structured extraction
- [x] `extract-all --domain <pattern>` — batch extraction by domain
- [x] `--domain` flag added to arg parser
- [x] Session output in CLI response handler
- [x] Backward compatibility preserved (text, save, tabs unchanged)

### Phase 6: Testing + Validation [IN PROGRESS]
- [ ] Reload extension in Chrome Dev Profile
- [ ] Test `extract-all --domain amazon` against live creatine tabs
- [ ] Verify session folder structure (manifest.json, reduced/*.md)
- [ ] Verify sidebar opens and shows tabs with schema indicators
- [ ] Test sidebar batch save
- [ ] Test raw fallback on non-Amazon page
- [ ] Validate Amazon schema selectors against actual DOM

## v2 Future Scope
- **Schema suggestion mode**: AI proposes schemas from raw pages
- **MCP server conversion**: Replace CLI with native MCP tools
- **Additional schemas**: Newegg, Best Buy, eBay, Walmart
- **Schema auto-update**: Detect when selectors break and alert
- **Chrome Web Store listing**: Package for public distribution

## Key Technical Decisions
- Schemas bundled into extension (via `extension/schemas/`) rather than fetched at runtime — offline-capable, no CORS issues
- Schema matching by domain + URL path pattern, not full URL — resilient to query parameter changes
- Extraction runs in Chrome's ISOLATED world — no interference with page JavaScript
- Session folders use local timestamps (not UTC) — matches Ryan's CST preference
- Side panel communicates with service worker via `chrome.runtime.sendMessage`, not WebSocket — simpler, no port conflict
