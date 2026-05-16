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
<!-- revised: 2026 May 16 19:20.0 -->

### 1. Chrome Extension
Install from the [Chrome Web Store](https://chromewebstore.google.com/) or load unpacked from the `extension/` folder.

### 2. Node.js Bridge

You need Node.js 22.6+ installed. Then run via `npx` — no global install needed,
works the same on Windows, macOS, and Linux:

```bash
npx page-save serve   # starts the server on localhost:7224
```

Saved output defaults to `~/Documents/saved-pages` on Windows, macOS, and
Linux. Set `PAGE_SAVE_DIR` before launching the server if you want a different
root folder.

(npx is the canonical Node.js way to run a CLI tool. We deliberately don't
ship a winget / Homebrew / apt package — it'd add a ~80MB Node bundle to a
50KB CLI, and any user who needs page-save already has Node for everything
else they're doing in this ecosystem. If you'd rather have `page-save` on
your PATH directly, `npm install -g page-save` works.)

### 3. (Optional) Launch the server from the extension
After loading the extension, register the local launch bridge so the side
panel can start the server itself when it's offline — no terminal needed
thereafter:

```bash
npx page-save setup
```

By default the host is registered for Chrome, Edge, **and** Brave so it just
works regardless of which Chromium-based browser you use. Restrict to a
specific browser with `--browser chrome,brave` if you want. For unusual
profiles or packaged extension IDs, pass `--extension-id <id>`. To inspect
what would be written without changing your machine, run
`npx page-save setup --dry-run`.

`setup` is a friendly alias for the lower-level `install-launcher` command.
The extension uses the same command name in the copyable LLM setup prompt it
shows when the local bridge is missing.

The installer uses the native mechanism for each operating system:

- **Windows:** writes the Chromium NativeMessagingHosts registry keys in both
  64-bit and 32-bit registry views, registers the `page-save://start` URL
  protocol, and creates the per-user `PageSaveLocalServer` scheduled task.
  The URL protocol opens a Page Save Local Server command window with the
  server status text. The native messaging host is a generated
  `bin/page-save-native-host.exe` wrapper so Chromium gets clean binary stdio.
- **macOS:** writes `com.pagesave.launcher.json` into the selected browser
  NativeMessagingHosts folders under `~/Library/Application Support/...`.
  The manifest points at a generated shell wrapper with the absolute Node.js
  path from your install command, and launch opens a Terminal window.
- **Linux:** writes the manifest into the selected browser folders under
  `~/.config/.../NativeMessagingHosts`. Launch opens an available terminal
  emulator (`x-terminal-emulator`, GNOME Terminal, Konsole, Xfce Terminal, or
  xterm), with a detached log-file fallback for headless sessions.

If the browser still reports "Specified native messaging host not found" after
installation, reload the extension; if the browser was already open before
registration, fully quit and reopen Chrome/Brave/Edge once.

After this, when the status pill shows "Server offline" the footer button
reads **"Launch Local Server"**. Click it; the panel waits for the
WebSocket to come up and then transitions back to "Save Selected (N)".
On Windows, the browser may show a one-time "Open Page Save?" prompt the
first time the button activates `page-save://start`; allow it.
The launch task opens a Page Save Local Server command window with the
connection port, project path, Node.js runtime, and log paths. Keep that
window open while using the extension; closing it stops the server.

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
