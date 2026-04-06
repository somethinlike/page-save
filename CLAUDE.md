# Page Save — AI-Optimized Browsing Assistant

## What This Is
A Chrome extension + Node.js bridge that captures web content and reduces it for AI consumption. Uses domain-specific extraction schemas to turn bloated web pages (40-400KB of text) into structured, minimal data (~2KB). Includes a Chrome sidebar UI for mass-selecting and saving tabs, and a CLI for AI-driven automation.

## Architecture
```
Chrome Sidebar UI          CLI (Claude Code)
       │                        │
       ▼                        ▼
  Chrome Extension ──WebSocket──► Node.js Server (port 7224)
       │                              │
  (extraction via                (file I/O)
   chrome.scripting)                  │
       ���                              ▼
       └──────────────────► saved-pages/sessions/
                            ├── reduced/  (schema-extracted)
                            └── raw/      (full text fallback)
```

- **Chrome Extension** (`extension/`): Manifest V3, Chrome Side Panel UI, schema-based extraction engine, WebSocket bridge
- **Node.js Bridge** (`src/`): WebSocket server + CLI. Handles session folder creation, markdown formatting, file I/O
- **Schemas** (`schemas/`): JSON files defining CSS selectors per domain for targeted data extraction

## How to Run

### Start the server
```bash
C:/Users/somet/.local/nodejs/node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts serve
```

### CLI Commands
```bash
# List all open tabs
page-save tabs

# Save a tab as MHTML (legacy)
page-save save --tab reddit

# Extract text only (legacy, full innerText)
page-save text --tab reddit

# Structured extraction — single tab (uses schema if available)
page-save extract --tab <id|pattern>

# Batch structured extraction — all tabs matching domain
page-save extract-all --domain amazon.com
```

(Replace `page-save` with `C:/Users/somet/.local/nodejs/node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts`)

### Chrome Sidebar
1. Click the page-save extension icon → side panel opens
2. Tabs are grouped by domain with schema indicators (green = schema, yellow = raw)
3. Select tabs via checkboxes, click "Save Selected"
4. Results written to `C:\Users\somet\Documents\saved-pages\sessions\`

### Load/Reload the Extension
1. Navigate to `chrome://extensions` in Dev Profile
2. Enable Developer mode
3. Click "Load unpacked" → select `C:\Users\somet\Projects\page-save\extension\`
4. After code changes, click the reload button on the extension card

## Schema System

Schemas live in `schemas/` (project source of truth) and are copied into `extension/schemas/` for the extension to load.

### Schema format
```json
{
  "domain": "amazon.com",
  "pages": {
    "search": {
      "urlPattern": "/s?",
      "container": "[data-component-type='s-search-result']",
      "fields": {
        "title": { "selector": "h2 a span", "type": "text" },
        "price": { "selector": ".a-price .a-offscreen", "type": "text" }
      }
    }
  }
}
```

Field types: `text`, `textAll`, `attribute`, `exists`. See `schemas/_template.json` for full docs.

### Adding a new schema
1. Create `schemas/{domain}.json`
2. Copy it to `extension/schemas/{domain}.json`
3. Add the filename to `extension/schemas/manifest.json`
4. Reload the extension

## Output Structure

```
saved-pages/
├── README.md              ← AI system prompt (auto-generated on first run)
├── sessions/
│   └── YYYY-MM-DD_HHmm/
│       ├── manifest.json  ← Index of all pages in session
│       ├── reduced/       ← Schema-extracted (structured markdown)
│       └── raw/           ��� Full text (no schema match)
│           └── GUIDANCE.md ← AI instructions for processing raw pages
```

## Key Files
| File | Purpose |
|------|---------|
| `src/server.ts` | WebSocket server + CLI entry point |
| `src/types.ts` | Message types, constants |
| `src/session-writer.ts` | Session folder creation, reduced/raw routing |
| `src/markdown-formatter.ts` | Structured data → markdown tables |
| `src/file-writer.ts` | MHTML file writing (legacy) |
| `extension/service-worker.js` | WebSocket client, Chrome API handlers, side panel messaging |
| `extension/extractors.js` | Schema registry, DOM extraction engine |
| `extension/sidepanel.html/js/css` | Chrome Side Panel UI |
| `extension/schemas/manifest.json` | Schema file registry |
| `schemas/*.json` | Domain extraction schemas (source of truth) |
| `templates/GUIDANCE.md` | Template for raw/ folder AI guidance |
| `templates/SAVED-PAGES-README.md` | Template for master README |

## Tech Stack
- Node.js 24 with `--experimental-strip-types` (no build step)
- TypeScript strict mode (type checking only, never compiled)
- WebSocket via `ws` package
- Chrome Extension Manifest V3 with Side Panel API
- ES Modules throughout

## Constraints
- Service worker must be plain `.js` (Chrome extensions can't load `.ts`)
- Import paths use `.ts` extension (required by `--experimental-strip-types`)
- No enums, decorators, or namespaces (not supported by type stripping)
- Port 7224 (outside dev project range 4321-4326)
- `chrome.pageCapture` cannot capture `chrome://` or `chrome-extension://` pages
- Schemas must be copied into extension dir AND registered in manifest.json

## Future: MCP Server
The CLI could be replaced by an MCP server so tools appear natively in Claude's tool list. The WebSocket bridge to Chrome stays the same. See `@modelcontextprotocol/sdk`.

## Calendar Versioning
Format: `YYYY.MM.DD.HHmm` (CST)
