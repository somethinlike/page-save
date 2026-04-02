# Page Save — Manual Test Guide
**Updated:** 2026.04.01

## Prerequisites
- Chrome with extension loaded (Developer mode, Load unpacked from `extension/`)
- Node.js server running: `npm run serve`
- Extension badge should not show errors

---

## 1. Setup & Connectivity

### 1.1 Server Start
- [ ] Run `npm run serve` — should print "Server listening on port 7224"
- [ ] No errors on startup

### 1.2 Extension Load
- [ ] Go to `chrome://extensions` → Developer mode ON
- [ ] Load unpacked → select `extension/` folder
- [ ] Extension appears with "Page Save Bridge" name
- [ ] No errors in extension card

### 1.3 Extension Connects
- [ ] With server running, inspect service worker (click "service worker" link on extension card)
- [ ] Console shows "[page-save] Connected to bridge server"
- [ ] Server terminal shows "Chrome extension connected"

### 1.4 Reconnection
- [ ] Stop server (Ctrl+C), extension console shows "[page-save] Disconnected"
- [ ] Restart server — extension should auto-reconnect within a few seconds
- [ ] Server shows "Chrome extension connected" again

---

## 2. List Tabs

### 2.1 Basic Tab Listing
- [ ] Open 3+ tabs (Wikipedia, Reddit, any other)
- [ ] Run `npm run tabs` — should print table with ID, Title, URL columns
- [ ] All open tabs appear (chrome:// tabs are filtered out)
- [ ] Tab IDs are numeric

---

## 3. Save Page

### 3.1 Save by URL Pattern
- [ ] Open a Wikipedia article
- [ ] Run `npm run save -- --tab wikipedia`
- [ ] Should print "Saved: C:\Users\somet\Documents\saved-pages\<title>-<timestamp>.mhtml"
- [ ] File exists at that path
- [ ] Open the .mhtml file in Chrome — should render the Wikipedia article with images

### 3.2 Save Protected Site (Reddit)
- [ ] Open a Reddit post with comments (logged in)
- [ ] Run `npm run save -- --tab reddit`
- [ ] MHTML file is saved successfully
- [ ] Open in Chrome — verify comments and authenticated content are present

### 3.3 Save Active Tab (No --tab Flag)
- [ ] Click on a specific tab to make it active
- [ ] Run `npm run save`
- [ ] Should save the currently active tab
- [ ] Verify correct tab was saved by checking title in output

### 3.4 Save with Custom Output Path
- [ ] Run `npm run save -- --tab wikipedia --out C:\Users\somet\Documents`
- [ ] File saved to the specified directory

### 3.5 Multiple Tabs Match Pattern
- [ ] Open two Reddit tabs
- [ ] Run `npm run save -- --tab reddit`
- [ ] Should show a warning about multiple matches
- [ ] Should use the first match and save successfully

---

## 4. Extract Text

### 4.1 Text from Normal Site
- [ ] Open a Wikipedia article
- [ ] Run `npm run text -- --tab wikipedia`
- [ ] Should print article text to stdout (no HTML tags)
- [ ] Text is readable and complete

### 4.2 Text from Protected Site
- [ ] Open a Reddit post
- [ ] Run `npm run text -- --tab reddit`
- [ ] Should print post content and comments as plain text
- [ ] No errors about CSP or content scripts

---

## 5. Keyboard Shortcut

### 5.1 Alt+S Save
- [ ] Focus a browser tab with content
- [ ] Press Alt+S
- [ ] Extension badge briefly shows "..." then "OK"
- [ ] Server terminal shows "Shortcut save: <path>"
- [ ] File exists at the logged path

---

## 6. Error Cases

### 6.1 No Matching Tab
- [ ] Run `npm run save -- --tab nonexistent-site-xyz`
- [ ] Should show "No tab matching" error with list of open tabs
- [ ] Exit code 1

### 6.2 Chrome:// Page
- [ ] Make chrome://extensions the active tab
- [ ] Run `npm run save`
- [ ] Should show error about restricted page types

### 6.3 Extension Not Connected
- [ ] Disable the extension in chrome://extensions
- [ ] Run `npm run tabs`
- [ ] Should show "Chrome extension not connected" error within 2 seconds
- [ ] Exit code 1

### 6.4 Server Not Running
- [ ] Stop the server
- [ ] Run `npm run tabs`
- [ ] Should auto-start the server and complete the command
- [ ] OR show clear error about how to start manually

---

## 7. Claude Integration

### 7.1 End-to-End Workflow
- [ ] In a Claude Code session, have Claude run the tabs command via Bash
- [ ] Claude can parse the tab listing output
- [ ] Have Claude save a Reddit page and read the MHTML file
- [ ] Claude can extract and discuss the content from the saved file
- [ ] Have Claude use the text command and work directly with the output
