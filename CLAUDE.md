# Page Save — Chrome Extension + Node.js Bridge

## What This Is
A tool that gives Claude Code the ability to save and read any browser tab's content, even from sites that block MCP content scripts (Reddit, Twitter/X, LinkedIn, etc.). Uses Chrome Extension APIs that operate at the browser engine level, bypassing all site-level content script restrictions.

## Architecture
```
Claude (Bash) → Node.js CLI/Server (port 7224) ←WebSocket→ Chrome Extension
                     |
                Writes MHTML to C:\Users\somet\Documents\saved-pages\
```

- **Chrome Extension** (`extension/`): Manifest V3, connects to local WebSocket, handles `list-tabs`, `save-page`, `get-text` via privileged Chrome APIs (`chrome.pageCapture.saveAsMHTML()`, `chrome.scripting.executeScript()`)
- **Node.js Bridge** (`src/`): WebSocket server + CLI. Claude calls it via Bash, server relays to extension, writes results to disk

## How to Run

### Start the server
```bash
eval "$(fnm env)" && node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts serve
```

### CLI Commands (what Claude calls)
```bash
# List all open tabs
node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts tabs

# Save a tab by URL pattern
node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts save --tab reddit

# Save active tab
node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts save

# Extract text only (no file I/O)
node --experimental-strip-types C:/Users/somet/Projects/page-save/src/server.ts text --tab reddit
```

### Load the Extension
1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select `C:\Users\somet\Projects\page-save\extension\`

## Tech Stack
- Node.js 24 with `--experimental-strip-types` (no build step)
- TypeScript strict mode (type checking only, never compiled)
- WebSocket via `ws` package
- Chrome Extension Manifest V3
- ES Modules throughout

## Constraints
- Service worker must be plain `.js` (Chrome extensions can't load `.ts`)
- Import paths use `.ts` extension (required by `--experimental-strip-types`)
- No enums, decorators, or namespaces (not supported by type stripping)
- Port 7224 (outside dev project range 4321-4326)
- `chrome.pageCapture` cannot capture `chrome://` or `chrome-extension://` pages

## Key Files
| File | Purpose |
|------|---------|
| `src/server.ts` | WebSocket server + CLI entry point (dual-mode) |
| `src/types.ts` | Message types, constants (port, save dir) |
| `src/file-writer.ts` | MHTML file writing, path sanitization |
| `extension/service-worker.js` | WebSocket client + Chrome API handlers |
| `extension/manifest.json` | Manifest V3 config |

## Calendar Versioning
Format: `YYYY.MM.DD.HHmm` (CST)
