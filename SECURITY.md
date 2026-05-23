# Security Model — Page Save Bridge
<!-- revised: 2026 May 22 20:01.1 -->

Page Save exists to let a local LLM workflow capture browser pages that ordinary browser automation cannot read because of CSP or site scripting restrictions. That means the security boundary has to be explicit.

## Trust Boundaries

- **Browser permission boundary:** the Chromium extension has `tabs`, `pageCapture`, `scripting`, and `<all_urls>` permissions only because the user installs and enables it.
- **Native launcher boundary:** the optional launcher is registered through Chromium native messaging and is scoped to specific extension IDs through `allowed_origins`.
- **Network boundary:** the Node.js bridge listens on `ws://127.0.0.1:7224` and rejects WebSocket clients whose TCP peer is not loopback.
- **Web origin boundary:** the bridge rejects browser-origin WebSocket clients unless the `Origin` header is a `chrome-extension://...` origin. Ordinary websites should not be able to use a victim's browser as a client for the local bridge.
- **Extension socket boundary:** extension-only message types, including sidebar session saves and keyboard-shortcut saves, require a successful Chromium-extension-origin handshake. A no-Origin local CLI/MCP socket is not allowed to impersonate the extension connection.
- **Background URL boundary:** batch extraction and watch runs open only `http://` and `https://` URLs in background tabs. Browser-internal, extension, file, script, data, and malformed URLs are rejected before they reach `chrome.tabs.create`.
- **Side panel rendering boundary:** tab titles, URLs, extracted page text, and preview snippets are rendered as text nodes in the extension UI, not inserted as HTML.
- **Tool-response boundary:** CLI/MCP extraction responses return the session path and a compact summary. Raw HTML/text/MHTML payloads are not echoed back through the tool response after the session is written.
- **LLM boundary:** an LLM session does not get browser cookies, profile storage, or direct tab internals. It can only see the tab list and capture/extraction output if its runtime is allowed to invoke the Page Save CLI or MCP tools.

## Approval Model

Page Save has two different approval surfaces:

- **Side panel workflow:** the user explicitly selects tabs, chooses Raw/Full/variant mode, previews the extraction, then confirms the save.
- **CLI/MCP workflow:** commands are intentionally automation-friendly. The human approval boundary is the LLM runtime's sandbox and command approval policy.

Treat these CLI/MCP operations as sensitive because they can expose authenticated page content:

- `page-save save`
- `page-save text`
- `page-save extract`
- `page-save extract-all`
- `page-save extract-pages`
- `page-save batch`
- `page-save youtube`
- `page-save session-add`
- `page-save watch-run`

Read-only setup or status commands such as `page-save setup --dry-run`,
`page-save serve`, and `page-save watch-list` are lower risk, but local policy
can still require approval for them.

## Output Boundary

The bridge writes output under the configured save directory. By default this is `~/Documents/saved-pages`; set `PAGE_SAVE_DIR` before starting the server to choose another directory.

Raw mode writes Chromium MHTML output, which should be treated like the file produced by the browser's **Save Page As** feature. Schema and variant modes write reduced markdown intended for LLM consumption, but they may still include private page content if the selected tab was authenticated.

## Current Limits

- Page Save does not yet provide a built-in per-request browser approval prompt for CLI/MCP commands.
- A process running as the same local user can connect as a local, no-Origin WebSocket CLI/MCP client. That is the same-user local process trust boundary used by most developer tools, but that client path cannot send extension-only sidebar/shortcut messages.
- WebSocket `Origin` checks are a browser-origin defense, not cryptographic authentication against arbitrary same-user processes that can craft custom headers.
- Another installed Chromium extension could still attempt to connect from its own `chrome-extension://...` origin. Native messaging launch is pinned by `allowed_origins`, and the WebSocket handshake checks extension-origin shape, but Page Save does not yet maintain a persisted allow-list for WebSocket extension IDs.
- The extension has broad host permissions so it can work on arbitrary pages. Users who need a narrower policy should install it only in a dedicated browser profile.

## Reporting

For security issues, contact Ryan Wills at somethinlike@gmail.com.
