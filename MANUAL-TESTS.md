# Page Save — Manual Test Guide
**Updated:** 2026.04.29 (Phases 1-15 complete)

## Prerequisites
- Chrome Dev Profile with extension loaded (Developer mode, Load unpacked from `extension/`)
- Node.js server: `C:/Users/somet/.local/nodejs/node --experimental-strip-types C:/Users/somet/Projects/page-save/src/cli.ts serve`
- Extension badge should not show errors

---

## 1. Setup & Connectivity

### 1.1 Server Start
- [ ] Run the serve command — should print "Server listening on port 7224"
- [ ] No errors on startup

### 1.2 Extension Load
- [ ] Go to `chrome://extensions` → Developer mode ON
- [ ] Load unpacked → select `extension/` folder
- [ ] Extension appears with "Page Save Bridge" name
- [ ] No errors in extension card

### 1.3 Extension Connects
- [ ] With server running, inspect service worker (click "service worker" link on extension card)
- [ ] Console shows "[page-save] Connected to bridge server"
- [ ] Console shows "[extractors] Loaded built-in schema: amazon.com v2" (and 13 others)
- [ ] Server terminal shows "Chrome extension connected"

### 1.4 Reconnection
- [ ] Stop server (Ctrl+C), extension console shows "[page-save] Disconnected"
- [ ] Restart server — extension should auto-reconnect within a few seconds
- [ ] Server shows "Chrome extension connected" again

---

## 2. List Tabs

### 2.1 Basic Tab Listing
- [ ] Open 3+ tabs (Wikipedia, Reddit, any other)
- [ ] Run `page-save tabs` — should print table with ID, Title, URL columns
- [ ] All open tabs appear (chrome:// tabs are filtered out)
- [ ] Tab IDs are numeric

---

## 3. Save Page (Legacy MHTML)

### 3.1 Save by URL Pattern
- [ ] Open a Wikipedia article
- [ ] Run `page-save save --tab wikipedia`
- [ ] Should print "Saved: C:\Users\somet\Documents\saved-pages\<title>-<timestamp>.mhtml"
- [ ] File exists at that path
- [ ] Open the .mhtml file in Chrome — should render the article with images

### 3.2 Save Protected Site (Reddit)
- [ ] Open a Reddit post with comments (logged in)
- [ ] Run `page-save save --tab reddit`
- [ ] MHTML file is saved successfully
- [ ] Open in Chrome — verify comments and authenticated content are present

### 3.3 Save Active Tab (No --tab Flag)
- [ ] Click on a specific tab to make it active
- [ ] Run `page-save save`
- [ ] Should save the currently active tab

### 3.4 Multiple Tabs Match Pattern
- [ ] Open two Reddit tabs
- [ ] Run `page-save save --tab reddit`
- [ ] Should show a warning about multiple matches
- [ ] Should use the first match and save successfully

---

## 4. Extract Text (Legacy)

### 4.1 Text from Normal Site
- [ ] Open a Wikipedia article
- [ ] Run `page-save text --tab wikipedia`
- [ ] Should print article text to stdout (no HTML tags)

### 4.2 Text from Protected Site
- [ ] Open a Reddit post
- [ ] Run `page-save text --tab reddit`
- [ ] Should print post content and comments as plain text

---

## 5. Structured Extraction (v2)

### 5.1 Single Tab — Amazon Search
- [ ] Open an Amazon search results page (e.g., search for "creatine")
- [ ] Run `page-save extract --tab amazon`
- [ ] Should print "Session saved: ...sessions/YYYY-MM-DD_HHmm"
- [ ] Should print "Schema: amazon.com/search — N items"
- [ ] Session folder contains `reduced/amazon.com-search-1.md`
- [ ] Markdown file has table with: asin, price, prime, rating, reviewCount, title
- [ ] All fields populated (not "—" for every row)
- [ ] Title shows full product name, not just brand

### 5.2 Batch — All Amazon Tabs
- [ ] Open 3+ Amazon search result pages
- [ ] Run `page-save extract-all --domain amazon`
- [ ] Should print total count with structured/raw breakdown
- [ ] Session folder has one .md file per page in `reduced/`
- [ ] `manifest.json` lists all pages with type "structured"

### 5.3 Raw Fallback — Unknown Domain
- [ ] Open a page from a site without a schema (e.g., any small e-commerce site)
- [ ] Run `page-save extract --tab <pattern>`
- [ ] Should save to `raw/` folder with full text
- [ ] `GUIDANCE.md` should appear in the `raw/` folder

### 5.4 Mixed Batch — Amazon + Unknown
- [ ] Open Amazon tabs AND a non-schema site tab
- [ ] Run `page-save extract-all` (no --domain filter)
- [ ] Session should have files in both `reduced/` and `raw/`
- [ ] `manifest.json` shows correct type for each page

### 5.5 Session Folder Structure
- [ ] After any extraction, verify folder: `saved-pages/sessions/YYYY-MM-DD_HHmm/`
- [ ] Contains `manifest.json`, `reduced/`, `raw/`
- [ ] First session ever creates `saved-pages/README.md` (AI guidance master file)
- [ ] Sessions with raw pages have `raw/GUIDANCE.md`

### 5.6 Walmart Search
- [ ] Open Walmart search results
- [ ] Run `page-save extract --tab walmart`
- [ ] Verify structured extraction with title, price, reviewCount fields

### 5.7 eBay Search
- [ ] Open eBay search results
- [ ] Run `page-save extract --tab ebay`
- [ ] Verify structured extraction with title, price, condition fields

### 5.8 Best Buy Search
- [ ] Open Best Buy search results
- [ ] Run `page-save extract --tab bestbuy`
- [ ] Verify structured extraction with title and price

### 5.9 Newegg Search
- [ ] Open Newegg search results
- [ ] Run `page-save extract --tab newegg`
- [ ] Verify structured extraction with title and price

---

## 6. Chrome Sidebar UI

### 6.1 Open Sidebar
- [ ] Click the Page Save extension icon in the toolbar
- [ ] Side panel opens showing tab list

### 6.2 Tab Grouping
- [ ] Open tabs from multiple domains (Amazon, Walmart, eBay, etc.)
- [ ] Sidebar groups tabs by domain
- [ ] Domains sorted by tab count (most first)
- [ ] Each domain shows schema badge: green "Schema" or yellow "Raw"

### 6.3 Selection
- [ ] Click a tab row checkbox — selects it
- [ ] Click domain header checkbox — selects all tabs in that domain
- [ ] "Select All" button selects everything
- [ ] "Deselect All" clears everything
- [ ] Save button shows count: "Save Selected (N)"

### 6.4 Batch Save from Sidebar
- [ ] Select multiple tabs across domains
- [ ] Click "Save Selected"
- [ ] Progress indicator appears
- [ ] Completion shows session path with structured/raw count
- [ ] Selection clears after save
- [ ] Session folder created with correct files

### 6.5 Connection Status
- [ ] With server running: status shows "Connected" (green)
- [ ] Stop server: status shows "Server offline" or "Disconnected" (red)
- [ ] Restart server: status updates on next "Refresh"

---

## 7. Keyboard Shortcut

### 7.1 Alt+S Save
- [ ] Focus a browser tab with content
- [ ] Press Alt+S
- [ ] Extension badge briefly shows "..." then "OK"
- [ ] Server terminal shows "Shortcut save: <path>"
- [ ] File exists at the logged path (MHTML, not session folder)

---

## 8. Error Cases

### 8.1 No Matching Tab
- [ ] Run `page-save save --tab nonexistent-site-xyz`
- [ ] Should show "No tab matching" error with list of open tabs
- [ ] Exit code 1

### 8.2 Chrome:// Page
- [ ] Make chrome://extensions the active tab
- [ ] Run `page-save save`
- [ ] Should show error about restricted page types

### 8.3 Extension Not Connected
- [ ] Disable the extension in chrome://extensions
- [ ] Run `page-save tabs`
- [ ] Should show "Chrome extension not connected" error
- [ ] Exit code 1

### 8.4 Server Not Running
- [ ] Stop the server
- [ ] Run `page-save tabs`
- [ ] Should auto-start the server and complete the command

---

## 9. Paginated Extraction (Phase 2)

### 9.1 Amazon Search Pagination
- [ ] Open a single Amazon search results tab
- [ ] Run `page-save extract-pages --tab amazon --max-pages 3`
- [ ] Should extract from 3 pages (auto-follows "Next" links)
- [ ] Session folder has 3 structured .md files in `reduced/`
- [ ] Cross-page dedup removes duplicate products
- [ ] `manifest.json` shows all 3 pages

### 9.2 Single Page (No Pagination)
- [ ] Open an Amazon product page (not search)
- [ ] Run `page-save extract-pages --tab amazon`
- [ ] Should extract just the one page (product schema has no pagination config)

### 9.3 Pagination on Non-Schema Site
- [ ] Open a page with no schema
- [ ] Run `page-save extract-pages --tab <pattern>`
- [ ] Should fall back to single raw text extraction

---

## 10. Schema Suggest (Phase 3)

### 10.1 Probe Unknown Domain
- [ ] Open a site without a schema (e.g., any product listing page)
- [ ] Run `page-save schema-suggest --tab <pattern>`
- [ ] Should print a schema summary with container selector and field candidates
- [ ] Should print raw JSON schema

### 10.2 Save Draft Schema
- [ ] Open a product listing page
- [ ] Run `page-save schema-suggest --tab <pattern> --save`
- [ ] Should save schema to `schemas/{domain}.json`
- [ ] JSON file is valid and follows schema format

---

## 11. Batch URL Scraping (Phase 4)

### 11.1 Batch from URL List
- [ ] Create a text file with 3 Amazon product URLs (one per line)
- [ ] Run `page-save batch --file urls.txt`
- [ ] Background tabs open and close automatically
- [ ] Session folder has 3 files in `reduced/`
- [ ] Products extracted correctly

### 11.2 Batch from Inline URLs
- [ ] Run `page-save batch --urls "https://amazon.com/dp/B00E9M4XFI,https://amazon.com/dp/B00GL2HMES"`
- [ ] Should extract from both URLs
- [ ] Session shows 2 structured results

---

## 12. Defuddle Clean Extraction (Phase 5)

### 12.1 Article Extraction
- [ ] Open a news article or blog post (no schema)
- [ ] Run `page-save extract --tab <pattern>`
- [ ] Raw output should be clean markdown — NO nav bars, ads, sidebars
- [ ] Has title, author, word count metadata at top
- [ ] Content is the article body only

### 12.2 Defuddle Fallback
- [ ] Open a page that Defuddle can't parse well (e.g., a form-heavy SPA)
- [ ] Run `page-save extract --tab <pattern>`
- [ ] Should fall back to raw innerText output

---

## 13. Confidence Scores (Phase 1)

### 13.1 Manifest Confidence Block
- [ ] Extract Amazon search results (multiple tabs)
- [ ] Open `manifest.json` in the session
- [ ] Should have a `confidence` key with per-field rates
- [ ] All Amazon search fields should have rate close to 1.0
- [ ] Fields sorted by rate (lowest first — broken selectors surface at top)

---

---

## 15. YouTube Transcript (Phase 6)

### 15.1 Extract Transcript
- [ ] Open a YouTube video with captions
- [ ] Run `page-save youtube --tab youtube`
- [ ] Session folder has `reduced/youtube.com-{videoId}.md`
- [ ] File has video metadata (title, channel, duration, language)
- [ ] Timestamped transcript lines present

### 15.2 No Captions
- [ ] Open a YouTube video without captions
- [ ] Run `page-save youtube --tab youtube`
- [ ] Should show "(No captions available for this video)"

---

## 16. MCP Server (Phase 7)

### 16.1 MCP Tools Available
- [ ] Configure `page-save-mcp` in Claude Desktop settings
- [ ] Verify tools appear: list_tabs, extract, extract_all, extract_pages, batch_urls, schema_suggest, youtube_transcript
- [ ] Call `list_tabs` — should return open Chrome tabs
- [ ] Call `extract` with a tab pattern — should create session

---

## 17. Price Watch (Phase 8)

### 17.1 Create Watch
- [ ] Run `page-save watch-add --url https://amazon.com/dp/B00E9M4XFI`
- [ ] Should print watch ID and URL
- [ ] Config file exists in `saved-pages/watches/{id}/config.json`

### 17.2 List Watches
- [ ] Run `page-save watch-list`
- [ ] Should show the watch created above

### 17.3 Run Watch
- [ ] Run `page-save watch-run --all`
- [ ] First run: "First snapshot" message, snapshot saved
- [ ] Run again: diff shows UNCHANGED (or changes if price changed)

---

## 18. Session Accumulation (Phase 9)

### 18.1 Session Lifecycle
- [ ] Run `page-save session-start` — should print session ID
- [ ] Run `page-save session-status` — should show active session
- [ ] Run `page-save session-add --tab <page1>` — should show page count
- [ ] Navigate to different page
- [ ] Run `page-save session-add --tab <page2>` — page count increments
- [ ] Run `page-save session-finalize` — session written to disk with both pages
- [ ] Verify manifest has both pages

### 18.2 Error: Double Start
- [ ] Start a session
- [ ] Try `page-save session-start` again — should error "already open"

---

## 19. Sidebar Preview (Phase 10)

### 19.1 Preview Flow
- [ ] Open sidebar, select tabs
- [ ] Click "Save Selected" — preview pane appears (not saved yet)
- [ ] Preview shows extracted content per item
- [ ] Uncheck an item — it dims out
- [ ] Click "Save Selected" in preview — only checked items saved
- [ ] Session folder reflects the filtered selection

### 19.2 Discard
- [ ] Open preview with extracted content
- [ ] Click "Discard" — returns to tab list without saving
- [ ] No session folder created

---

## 20. Delta Mode (Phase 11)

### 20.1 Delta Annotations
- [ ] Extract Amazon search: `page-save extract-all --domain amazon`
- [ ] Note the session directory path
- [ ] Wait or change tab content
- [ ] Re-extract with delta: `page-save extract-all --domain amazon --prev <session-dir>`
- [ ] Output has `delta` column: NEW for new items, CHG for changed, empty for unchanged

---

## 21. AI Integration

### 21.1 Claude Code End-to-End
- [ ] Have Claude run `extract-all --domain amazon` via Bash
- [ ] Claude reads the session's `reduced/*.md` files
- [ ] Claude can answer product comparison questions from the extracted data

### 21.2 AI Readability
- [ ] Point any AI at `saved-pages/` and ask it to summarize the latest session
- [ ] AI reads `README.md` first, then session contents
- [ ] AI can parse the markdown tables correctly

---

## 22. Schema Variants (Phase 13)

### 22.1 Sidebar Dropdown Renders
- [ ] Reload the extension in `chrome://extensions` (so updated code loads)
- [ ] Open the side panel
- [ ] Open one Amazon search tab and one non-schema tab (e.g. Wikipedia)
- [ ] In the Amazon group, the row beside the domain name is a dropdown with options: `Raw`, `Schema (full)`, `titles`, `prices`, `rated`
- [ ] In the Wikipedia group, the dropdown only shows `Raw`
- [ ] Default selection is `Raw` for both groups

### 22.2 Selection Persists
- [ ] Pick `prices` for the Amazon group
- [ ] Close and reopen the side panel
- [ ] The Amazon group's dropdown is still set to `prices` (chrome.storage.local survived)
- [ ] Restart the browser — selection survives

### 22.3 Sidebar Variant Extraction
- [ ] Set Amazon to `prices`, select an Amazon search tab, click `Save Selected`
- [ ] Preview pane shows items containing only `asin`, `title`, `price` (no rating, no reviewCount, no prime)
- [ ] Confirm save — `manifest.json` records `variant: "prices"` for that result
- [ ] Set Amazon to `Raw`, repeat — output goes to `raw/`, not `reduced/`

### 22.4 CLI --variant Flag
- [ ] Open an Amazon search tab
- [ ] `page-save extract --tab amazon --variant titles` — output contains only `asin` + `title` columns
- [ ] `page-save extract --tab amazon --variant prices` — adds `price` column
- [ ] `page-save extract --tab amazon --variant rated` — adds rating + reviewCount

### 22.5 CLI --raw Flag
- [ ] Open an Amazon search tab
- [ ] `page-save extract --tab amazon --raw` — bypasses schema, output is raw text in `raw/` (Defuddle-cleaned)
- [ ] `page-save extract --tab amazon --variant raw` (alias) — same behavior

### 22.6 Variant On Unknown Domain
- [ ] Open a Wikipedia tab
- [ ] `page-save extract --tab wikipedia --variant prices` — there's no schema, so the variant is ignored and it falls back to raw extraction (no error)

### 22.7 Variant + Pagination
- [ ] On an Amazon search results page
- [ ] `page-save extract-pages --tab amazon --variant titles --max-pages 2` — both pages extracted with only `asin` + `title`

---

## 23. Server Launch From Extension (Phase 14)

### 23.1 First-Time Install
- [ ] Get extension ID from `chrome://extensions` (Developer mode on, page-save card)
- [ ] Run `page-save install-launcher --extension-id <id>` — prints "Native messaging host registered for chrome."
- [ ] `reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pagesave.launcher"` shows the manifest path
- [ ] `bin/com.pagesave.launcher.json` exists with the correct extension ID in `allowed_origins`

### 23.2 Reload Extension
- [ ] After `install-launcher`, reload the extension once so the `nativeMessaging` permission is active
- [ ] Side panel still loads; status pill shows current connection state

### 23.3 Launch With Server Offline
- [ ] Stop any running `page-save serve` process
- [ ] Open the side panel — status pill = "Server offline" (red), footer button reads **"Launch Local Page-Save Server"** in blue
- [ ] Click — button changes to "Launching server…" (disabled)
- [ ] Within ~2s, status flips to "Connected" and the button transitions back to "Save Selected (0)"
- [ ] `netstat -ano | grep 7224` shows a LISTENING entry — the spawned server is detached and survives the launcher exiting

### 23.4 Launch With Server Already Running
- [ ] Start `page-save serve` manually first
- [ ] In a fresh side panel, the status pill should already say "Connected" (the periodic 4s poll picks this up)
- [ ] If you somehow click before the poll updates, the launcher's pre-flight probe detects the running server and returns `alreadyRunning:true` without spawning a duplicate
- [ ] `netstat` shows exactly one PID on port 7224

### 23.5 Spam Click Protection
- [ ] With server offline, click the launch button rapidly 5+ times within 1 second
- [ ] Only one launch attempt actually fires (UI debounce + service-worker 5s cooldown both enforce this)
- [ ] `tasklist | findstr node` does not show a stack of duplicate node processes

### 23.6 Port Conflict
- [ ] In a separate terminal, occupy port 7224 with something that isn't page-save: `python -m http.server 7224 --bind 127.0.0.1`
- [ ] In the side panel, click the launch button
- [ ] Status text under the button reads "Port 7224 is in use by something that isn't page-save." (or similar)
- [ ] The launcher does NOT spawn a node process on top of the conflict

### 23.7 Launcher Not Installed
- [ ] Delete the registry key: `reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pagesave.launcher" /f`
- [ ] Click launch button → error reads "Launcher not installed. Run: page-save install-launcher --extension-id <id>"
- [ ] Re-running the install command and reloading the extension restores normal operation

### 23.8 Launcher Reports Started But No Connection
- [ ] (Hard to reproduce naturally — would require the spawned server to crash before binding)
- [ ] If it happens: error reads "Server started but didn't accept connections in time. Check the terminal for errors."
- [ ] User can run `page-save serve` manually to see the actual error

---

## 24. Multi-Selector Fallback for Variant Listings (Phase 15)

### 24.1 Multi-Variant Amazon Listings Now Extract Prices
- [ ] Search Amazon for "king oscar sardines" — open the search results in a tab
- [ ] Multi-variant listings (the ones with "See available options" or a price range like "$5.03 - $68.14") are present
- [ ] Run `page-save extract --tab "king oscar"` (or save via sidebar with `prices` variant)
- [ ] At least 80%+ of King Oscar listings now have a populated `price` field (vs ~50% before Phase 15)
- [ ] When a listing has a price range, the extracted price is the lower bound (consistent with `parse_price` regex picking the first match)

### 24.2 Schema Author Workflow
- [ ] Open `schemas/amazon.com.json` — `price` is an array of 4 selectors
- [ ] Edit a non-Amazon schema (e.g., `schemas/walmart.com.json`) — `selector` accepts both string (existing) and array (new) forms; existing string selectors continue to work without modification
- [ ] Manually probe a field with a partial DOM match (delete the first selector class) — extractor falls through to the next selector and still returns the right value

### 24.3 Coverage Regression Check
- [ ] Re-run a saved sardine search session before/after Phase 15
- [ ] Compare `confidence.fields[where field='price'].rate` in `manifest.json`
- [ ] Phase 15 rate should be > Phase 13 rate for the `price` field on amazon.com/search
