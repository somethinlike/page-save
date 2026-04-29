# Page Save Bridge

Give AI coding assistants the ability to save and read any browser tab — even sites that block automation tools like Reddit, Twitter, and LinkedIn.

Built with care by [ESDF.gg](https://esdf.gg) and [The Open English Bible Ministry](https://logospraxis.church).

*"'You shall love the Lord your God with all your heart and with all your soul and with all your mind.' This is the greatest and first commandment. And a second is like it: 'You shall love your neighbor as yourself.'"* — Matthew 22:37-39 (NRSVue)

## The Problem

Claude Code's browser tools (and similar AI automation) get blocked by Content Security Policy on many sites. Reddit, Twitter/X, LinkedIn — the AI can see the tab exists but can't read the content. You end up pressing Ctrl+S manually and pointing the AI at the saved file.

## The Solution

Page Save Bridge uses `chrome.pageCapture.saveAsMHTML()` — a browser-engine-level API that operates **below** CSP restrictions. It captures the fully-rendered page with your existing sessions, cookies, and authentication intact.

**Two components:**
1. **Chrome Extension** — connects to a local WebSocket server, handles save/text/list commands
2. **Node.js Bridge** — CLI that your AI calls via Bash to trigger saves and read content

## Install

### 1. Chrome Extension
Install from the [Chrome Web Store](https://chromewebstore.google.com/) or load unpacked from the `extension/` folder.

### 2. Node.js Bridge
```bash
# Start the server (runs on localhost:7224)
npx page-save serve
```

### 3. (Optional) Launch the server from the extension
After loading the extension, register a small native-messaging host so the
side panel can start the server itself when it's offline — no terminal needed:

```bash
# Get your extension ID from chrome://extensions, then:
npx page-save install-launcher --extension-id <id>
```

After this, when the status pill shows "Server offline" the footer button
reads **"Launch Local Page-Save Server"**. Click it; the panel waits for the
WebSocket to come up and then transitions back to "Save Selected (N)".

The launcher refuses to spawn a duplicate when the port is already bound,
debounces rapid clicks, and reports a clear error if something else is
holding port 7224.

## Usage

```bash
# List all open Chrome tabs
npx page-save tabs

# Save a Reddit page as MHTML (matches URL pattern)
npx page-save save --tab reddit

# Extract plain text from any tab
npx page-save text --tab reddit

# Save the currently active tab
npx page-save save
```

**Keyboard shortcut:** Press `Alt+S` to save the active tab instantly.

## How It Works

```
AI Agent (Bash) → Node.js CLI (port 7224) ←WebSocket→ Chrome Extension
                       |
                  Writes MHTML to saved-pages/
```

The extension uses privileged Chrome APIs that sites cannot block:
- `chrome.pageCapture.saveAsMHTML()` — captures full page with all resources
- `chrome.scripting.executeScript()` — extracts text in an isolated world

## Why Not Just Use Browser MCP / Chrome DevTools MCP?

Those tools inject content scripts into pages, which gets blocked by CSP on sites like Reddit. Page Save operates at the browser engine level — there's nothing for the site to block.

## Privacy

Zero data collection. All communication is localhost-only. No analytics, no tracking, no external requests. See [PRIVACY.md](PRIVACY.md).

## License

CC0 1.0 — Public Domain. Do whatever you want with it.
