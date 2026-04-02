# Privacy Policy — Page Save Bridge

**Last updated:** April 2, 2026

## Data Collection

Page Save Bridge collects **no data**. Zero. None.

## How It Works

- The extension communicates exclusively with a **local WebSocket server** running on your own machine (`localhost:7224`).
- No data is sent to any external server, cloud service, or third party.
- Page content captured via `chrome.pageCapture.saveAsMHTML()` is sent only to your local machine over localhost.
- The extension does not track browsing history, collect analytics, or transmit telemetry.

## Permissions Used

| Permission | Why |
|-----------|-----|
| `pageCapture` | Save the current tab as an MHTML file |
| `tabs` | List open tabs so the CLI can target a specific one |
| `activeTab` | Access the currently focused tab for keyboard shortcuts |
| `scripting` | Extract plain text from a tab via `document.body.innerText` |
| `alarms` | Keep the WebSocket connection alive (Chrome suspends idle service workers) |
| `<all_urls>` | Required by `chrome.scripting.executeScript()` to work on any website |

## Third Parties

None. This extension has no analytics, no tracking, no ads, no external network requests.

## Contact

Ryan Wills — somethinlike@gmail.com
GitHub: https://github.com/somethinlike/page-save
