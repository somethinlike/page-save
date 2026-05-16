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

## Phase 1: Confidence Scores Per Field ✅ DONE (2026-04-09)

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

## Phase 2: Pagination Auto-Follow ✅ DONE (2026-04-09)

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

## Phase 3: Schema Suggest Command ✅ DONE (2026-04-09)

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

## Phase 4: Batch URL Scraping ✅ DONE (2026-04-09)

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

## Phase 5: Defuddle Fallback Engine ✅ DONE (2026-04-09)

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

## Phase 6: YouTube Subtitle Extraction ✅ DONE (2026-04-09)

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

## Phase 7: MCP Server Integration ✅ DONE (2026-04-09)

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

## Phase 8: Monitoring / Price Watch ✅ DONE (2026-04-09)

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

## Phase 9: Multi-Page Session Accumulation ✅ DONE (2026-04-09)

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

## Phase 10: Sidebar Preview/Edit Before Save ✅ DONE (2026-04-09)

**Value:** Users can't currently review extracted content before it's written to disk. A preview step lets users trim irrelevant sections, verify extraction quality, and catch schema errors before the data hits the AI pipeline.

**What:** After extraction but before writing, show the extracted content in the sidebar. Users review, toggle sections on/off, then confirm save.

**Files:**
- `extension/sidepanel.js` — add preview pane state. After extraction, render results as markdown preview instead of immediately sending to Node.js. Add per-section/per-item toggle checkboxes. "Save" button sends filtered results.
- `extension/sidepanel.html` — preview pane markup with section toggles and save/discard buttons
- `extension/sidepanel.css` — preview pane styling (markdown rendering, toggle states)
- `extension/service-worker.js` — new `preview-extraction` action that returns results to sidebar instead of forwarding to server. Existing `get-structured` path unchanged for CLI usage.

**No new CLI commands.** This is a sidebar-only UX enhancement. CLI extractions continue to write directly (no interactive preview needed when an AI is driving).

---

## Phase 11: Incremental Extraction (Delta Mode) ✅ DONE (2026-04-09)

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

## Phase 13: Schema Variants ✅ DONE (2026-04-27)

**Value:** Same domain, different extraction goals. Cooking-research browse needs raw text; price comparison needs `[asin, title, price]`; quality filtering needs ratings too. Selecting a variant per domain group lets the user opt into the minimum-tokens projection that fits the current task.

**What:**
- Schema gets an optional `variants` block: `{ name: { description, fields: [...], fieldOverrides? } }`
- Variant = projection of the base page fields (subset of names; future: per-page selector overrides)
- Sidebar dropdown per domain group: `Raw` (default), `Schema (full)`, then one entry per variant
- Selection persists to `chrome.storage.local` keyed by canonical domain
- CLI: `--variant <name>` projects fields; `--raw` (or `--variant raw`) forces raw fallback
- Default everywhere is **Raw** (Ryan's call: opt-in to schemas, never auto-apply unrequested)

**Files:**
- `schemas/amazon.com.json` + `extension/schemas/amazon.com.json` + `BUILTIN_SCHEMAS` — added `titles`, `prices`, `rated` variants (also bumped to v3)
- `extension/extractors.js` — `applyVariant(schema, pageType, basePage, name)` projector; `extractStructured` and `extractWithPagination` accept `{ variant, forceRaw }` options
- `extension/service-worker.js` — every extraction handler accepts and forwards options; new `get-schema-info` message returns variants per domain for the dropdown
- `extension/sidepanel.js` + `sidepanel.css` — dropdown replaces the `Schema/Raw` badge; `perTabOptions` map sent on `preview-extract`
- `src/cli.ts` — `--variant <name>` and `--raw` flags
- `src/ws-handler.ts` + `src/types.ts` — variant/forceRaw on every `get-structured*` and `batch-urls` request

---

## Phase 14: Server Launch From Extension Menu ✅ DONE (2026-05-16)

**Update 2026-05-16:** The earlier "host not found" behavior was local install drift, not a Chrome/Brave capability blocker. The machine-local generated manifest pointed at the old `C:\Users\somet\Projects\page-save` path, registry entries were absent, and browser profiles contained both stale and current unpacked Page Save extension IDs. `page-save install-launcher` now auto-detects active Page Save unpacked extension IDs from Chrome/Brave/Edge profile preferences, includes all matching IDs in `allowed_origins`, and regenerates the manifest with the current repo path. The side-panel offline primary action now reads **"Launch Local Server"** and transitions back to `Save Selected (N)` when the WebSocket reconnects.

**Update 2026-05-03:** All four pieces of the launcher work in isolation:
- Native messaging host script (`src/native-launcher.ts`) responds correctly to `status` and `start` actions when invoked directly via stdin (verified multiple times)
- The `.bat` wrapper exits cleanly, returns the right framing
- `page-save install-launcher` writes a valid manifest at `bin/com.pagesave.launcher.json` and registers the `(Default)` REG_SZ value at `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pagesave.launcher` (and Edge + Brave equivalents)
- `chrome.runtime.sendNativeMessage` from the extension service worker correctly serializes the call

**The blocker:** `chrome.runtime.sendNativeMessage('com.pagesave.launcher', ...)` consistently returns `lastError = "Specified native messaging host not found"` on Ryan's Brave 147.1.89.145 install (and Chrome too, per cross-test). Yet at the SAME parent registry key, `chrome.runtime.sendNativeMessage('com.8bit.bitwarden', ...)` returns `"Access ... is forbidden"` — meaning Brave finds Bitwarden's manifest fine but ours specifically isn't located.

**Diagnostics performed (all ruled out):**
- Wrong registry path → wrote to all 5 plausible Chromium-derived paths (Brave, BraveSoftware\Brave-Browser, Brave-Browser, Chromium, Google\Chrome)
- 32-bit vs 64-bit registry view — entry verified present in BOTH via PowerShell's `RegistryView::Registry32` / `Registry64`
- `.bat` rejected by Chromium — pointed manifest's `path` at `node.exe` directly, then at Bitwarden's working `desktop_proxy.exe`
- Manifest in `Temp` directory rejected — moved to `AppData\Local\page-save\` then `AppData\Roaming\page-save\`
- Filename pattern (`com.pagesave.launcher.json`) — renamed to `host.json`
- CRLF vs LF line endings — wrote LF-only matching Bitwarden's exact bytes
- ACL pattern — verified file ACL and registry-key ACL are identical between our entry and Bitwarden's
- Manifest field structure — byte-cloned Bitwarden's manifest with only `name` swapped
- Multiple allowed_origin format variants — single trailing-slash entry, both formats, multi-origin
- Cache / restart issue — Brave fully restarted, all `brave.exe` processes killed, extension toggled off+on
- Permission missing — `chrome.runtime.getManifest().permissions` confirmed `nativeMessaging` is in the active list, `chrome.permissions.getAll` shows 8 granted permissions matching declared
- Verbose Brave log (`--enable-logging --v=1 --vmodule=*native_message*=3`) confirms Brave logs `Can't find manifest for native messaging host com.pagesave.launcher` from `launch_context.cc:148` — same code path as truly-absent hosts (Anthropic Claude extensions, Google Drive). The `FindManifest` function in Chromium source returns empty path despite the registry entry existing.

**Reading Chromium source** at `chrome/browser/extensions/api/messaging/launch_context_win.cc`: `FindManifest` calls `GetManifestPath(HKEY_CURRENT_USER, host_name, &result)` which tries 32-bit then 64-bit views. `GetManifestPathWithFlagsFromSubkey` does three sequential operations: open parent key, open subkey, read default value. ALL three must succeed. We've verified all three succeed manually via PowerShell's `OpenSubKey` + `GetValue('')`. Yet Chromium's call returns false.

**What this looks like:** something Chromium-internal is short-circuiting our specific entry. Possibly a stale negative-cache from earlier debugging iterations; possibly a Brave 147.x bug specific to dynamically-added hosts on a running profile; possibly a profile-level allowlist that Bitwarden+GoogleDrive+MicrosoftBrowserCore are grandfathered into.

**Next session pickup:** the verified-working things are valuable infrastructure to keep. The remaining mystery is purely on the Chromium/Brave-side discovery code path and likely needs either:
1. A fully fresh Brave profile (or different Brave install — Beta, Nightly) to test
2. Chromium source instrumentation (build a debug Brave) to see why `RegKey::Open` fails for our subkey but succeeds for Bitwarden's
3. Reporting upstream to Brave with the verbose log

The extension's launch button still UX-displays the "Launcher not installed" error correctly when this happens (Phase 14 commit `50d8e5a`), so user impact is bounded — they fall back to running `page-save serve` in a terminal manually, which still works perfectly.

**Problem:** A Chrome extension is sandboxed and cannot spawn a Node.js process directly. Today, the user must run `page-save serve` in a terminal *before* the extension can do anything. When the connection drops (server crash, machine reboot), the user has to drop into a terminal again. The status pill says "Disconnected" — but offers no recovery action.

**Goal:** A "Start Server" button in the side panel that, when the WebSocket is offline, spawns the Node.js server in the background and reconnects automatically.

**Approach: Chrome Native Messaging Host**

Native messaging is Chrome's sanctioned escape hatch from the extension sandbox: an extension can invoke a registered native binary via `chrome.runtime.sendNativeMessage(host, message)`. The binary spawns the server as a detached child and reports back. This is exactly the use case native messaging was designed for (cf. 1Password, Bitwarden, KeePassXC).

**Components:**

1. **Native host launcher** (`bin/page-save-launcher.bat` on Windows; `.sh` on Unix)
   - Reads a 4-byte length-prefixed JSON message from stdin
   - On `{"action":"start"}`, spawns `node --experimental-strip-types src/cli.ts serve` detached, ignoring stdio so the parent (Chrome) can exit without orphaning the server
   - On `{"action":"status"}`, attempts a TCP connect to `127.0.0.1:7224`; replies `{"running": true|false}`
   - Writes a 4-byte length-prefixed JSON response to stdout

2. **Native host manifest** (`bin/com.pagesave.launcher.json`)
   ```json
   {
     "name": "com.pagesave.launcher",
     "description": "Page Save server launcher",
     "path": "<absolute path to launcher>",
     "type": "stdio",
     "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
   }
   ```
   - Windows: registered under `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pagesave.launcher` with the manifest path as the default value (no admin needed)
   - macOS/Linux: copied to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` or `~/.config/google-chrome/NativeMessagingHosts/`

3. **Install command** (`page-save install-launcher`)
   - Generates the manifest with the absolute launcher path
   - Auto-detects active unpacked Page Save extension IDs from local Chrome/Edge/Brave profiles; accepts `--extension-id` for unusual cases
   - Writes the manifest, registers it (registry on Windows, file copy on Unix)
   - Idempotent — re-running updates the path/extension ID

4. **Extension changes**
   - `manifest.json`: add `"nativeMessaging"` permission
   - `service-worker.js`: handle a `start-server` message; call `chrome.runtime.sendNativeMessage('com.pagesave.launcher', {action:'start'})`; after success, re-attempt `connect()` on the WebSocket
   - `sidepanel.js`: when status is "Disconnected", show a "Launch Local Server" button; on click, send the message and update the status

**Edge cases:**
- Server already running → launcher's status check returns `running: true`, button no-ops
- Manifest not installed yet → `sendNativeMessage` errors; fall back to current behavior (manual instructions in the disconnected state)
- Multiple Chrome profiles → each profile's extension has a different ID, so the manifest's `allowed_origins` may need multiple entries. The install command can accept a list.

**Why not other approaches:**
- *Custom URL scheme handler* (`pagesave://start`) — works but registering a protocol handler on Windows is also a registry write, no simpler than native messaging, and offers no return channel for status.
- *Background scheduled task / service* — over-engineered; the user explicitly didn't want a daemon (per `feedback_friction_as_signal` — idleness should surface, not hide).
- *Auto-start on Chrome launch* — same problem; the user wants explicit on-demand control.

**Estimated scope:** ~150 LoC (launcher + install command + extension wiring) + manifest + tests. Targeted as a single-commit follow-up.

**As-built (2026-04-28):**
- `src/native-launcher.ts` — stdio framing, status/start actions, port pre-flight, post-launch re-probe (~140 LoC)
- `bin/page-save-launcher.bat` — self-locating Node lookup (avoids fnm shim per `feedback_ps7_msix.md`)
- `bin/page-save-server-start.bat` + `bin/page-save-server-start.vbs` — Windows ShellExecute path for launching the long-lived server outside the native host process tree
- `src/install-launcher.ts` — writes `bin/com.pagesave.launcher.json`, registers under `HKCU\...\NativeMessagingHosts`, supports Chrome/Edge/Brave
- `extension/manifest.json` — `nativeMessaging` permission added
- `extension/service-worker.js` — `handleLaunchServer()` enforces 4 safety layers: 5s cooldown, pre-flight WS probe, port-conflict detection (native side refuses to spawn over a busy port), 10s connect-timeout polling
- `extension/sidepanel.js` — `updateSaveButton()` is mode-aware: footer button reads "Launch Local Server" when offline, "Save Selected (N)" when online. 4s status polling auto-transitions back when server comes up. UI-side 5s debounce mirrors service-worker cooldown.

**Still manual:** the user runs `page-save install-launcher` once after first install. Auto-detection covers local unpacked Chrome/Brave/Edge installs; `--extension-id <id>` remains available for unusual profiles or packaged extension IDs.

---

## Phase 15: Multi-Selector Fallback for DOM Variants ✅ DONE (2026-04-29)

**Value (revised after measurement):** Originally hypothesized to fix the ~5% missing-price gap on Amazon. **Measurement shows it only moves the price-field rate from 91.30% → 91.90%** on a sardine search batch. Still ships because (a) the architectural support for selector arrays is generally useful for any future schema dealing with DOM A/B tests or layout variants, and (b) those few marginal cases it does fix are real — listings where Amazon renders a `.a-price-range` instead of `.a-price`, or where the `data-cy="price-recipe"` div has a price inside. The bulk of the remaining missing prices turn out to be a **different problem entirely**, which Phase 16 addresses: search cards for multi-variant listings (King Oscar's "Pack of 6/12/18" SKUs) have **literally empty price-recipe divs** — Amazon doesn't render any price hint, range, or "From $X" text. No selector can extract what isn't there. Verified via the `probe-result-html` action shipped with this phase.

**What changed:**
- `extension/extractors.js` — `extractField` now branches on `Array.isArray(selector)`. Helper `extractFieldOnce` is the old single-selector path; the new top-level `extractField` loops over the array and returns the first non-empty match. `isEmpty` correctly distinguishes `false` (a real `exists`-type result) from `null` / `''` / `[]` (empty).
- `schemas/amazon.com.json` + extension copy + `BUILTIN_SCHEMAS` — bumped to v4. `price` field is now `[".a-price .a-offscreen", ".a-price-range .a-offscreen", "[data-cy='price-recipe'] .a-offscreen", ".a-color-price"]` for search; product-page price has its own fallback array including legacy `#priceblock_*` selectors for older Amazon layouts.
- `extension/service-worker.js` — added `probe-result-html` action (one-shot debugging to capture outerHTML of search-result containers by ASIN; useful for grounding future schema improvements).
- `SCHEMA-CONVENTIONS.md` — documents the array form with rules: only use it for legitimate DOM variation, not "let me try a few things." Document why each fallback exists.

**Backward-compatible.** Existing schemas with string-form `selector` work unchanged.

**Why the probe action shipped even though we didn't use it for this fix:** the action is small (~25 LoC) and gives a clean way to inspect Amazon's actual DOM next time a schema regresses. Better to ship the debugging tool now than re-derive it later.

---

## Phase 16: Follow-Through to Product Page for Empty Search-Card Prices (Designed)

**Problem:** The verification under Phase 15 confirmed that ~8% of Amazon search results have **truly empty** price-recipe divs — Amazon doesn't render price text on the card for multi-variant listings (King Oscar's heavily-variantized SKUs are the canonical example). No CSS-selector strategy can extract a price that doesn't exist in the DOM. The user clicking through to /dp/<ASIN> is the only way Amazon shows them a number.

**Goal:** When the search-page extractor returns empty `price` (or any opt-in field), automatically follow the listing's product-detail-page URL, extract the field there, and merge the value back into the search session. Reuse Phase 4's batch-URLs background-tab infrastructure.

**Design:**
- New CLI flag: `--follow-empty <field>` (and matching schema property `followEmpty: ["price"]` for the default behavior on a per-domain basis).
- After the search-page extraction completes, scan results for items where the named field is null/empty.
- For each: derive the product page URL from the ASIN (or from a `productUrl` field in the schema), open in a background tab via `chrome.tabs.create({ active: false })`, extract the product schema, copy the requested field back to the original result, close the tab. Concurrency limit 3 (matches existing batch-urls).
- Merge results back into the session manifest with a `priceSource: "product-page"` annotation so it's auditable which prices were follow-through vs. card-direct.
- Cost: ~2-3s per missing-price ASIN. For a typical 50-result Amazon search with ~5 missing, that's 10-15s extra — acceptable for a price-comparison workflow, opt-in for fast browsing.

**Edge cases:**
- Listing has no /dp/<ASIN> URL (rare, mostly old marketplace items) — skip silently.
- Product page is itself a variant chooser ("Choose a size" before showing a price) — extract the *lowest* variant's price, mark with `priceVariant: "min-of-N"`. Or skip entirely with a flag the user controls.
- Out-of-stock / "Currently unavailable" — surface as a distinct state, not as `null`.

**Estimated scope:** ~80 LoC across `extractors.js` (post-process pass), `service-worker.js` (orchestration), and `ws-handler.ts` (CLI flag plumbing). Schema docs update. Manual test entry. Single follow-up commit.

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

## Cross-Cutting: Configurable Timeout ✅ DONE (2026-04-09)

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
