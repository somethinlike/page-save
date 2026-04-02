import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PORT, SAVE_DIR } from './types.ts';
import type { WsRequest, WsResponse, TabInfo, SavePageResult, GetTextResult } from './types.ts';
import { writeMhtml } from './file-writer.ts';

// --- Argument Parsing ---

function parseArgs(argv: string[]): { action: string; tab?: string; output?: string } {
  const args = argv.slice(2);
  const action = args[0] || 'serve';
  let tab: string | undefined;
  let output: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--tab' && args[i + 1]) {
      tab = args[i + 1];
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }

  return { action, tab, output };
}

// --- Server Mode ---

interface PendingRequest {
  resolve: (value: WsResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function startServer(): void {
  const wss = new WebSocketServer({ port: PORT });
  let extensionSocket: WebSocket | null = null;
  const pendingRequests = new Map<string, PendingRequest>();

  console.log(`[page-save] Server listening on port ${PORT}`);

  wss.on('connection', (socket) => {
    let isExtension = false;

    socket.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Extension handshake
      if (msg.type === 'extension-hello') {
        extensionSocket = socket;
        isExtension = true;
        console.log('[page-save] Chrome extension connected');
        return;
      }

      // Shortcut-initiated save (unsolicited from extension)
      if (msg.type === 'shortcut-save' && msg.result) {
        const result = msg.result as SavePageResult;
        const filePath = writeMhtml(result.data, result.title);
        console.log(`[page-save] Shortcut save: ${filePath}`);
        return;
      }

      // Extension response to a pending request
      if (msg.id && isExtension) {
        const pending = pendingRequests.get(msg.id as string);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(msg.id as string);
          pending.resolve(msg as unknown as WsResponse);
        }
        return;
      }

      // CLI command
      if (msg.type === 'cli-command') {
        handleCliCommand(socket, msg, extensionSocket, pendingRequests);
        return;
      }
    });

    socket.on('close', () => {
      if (isExtension) {
        console.log('[page-save] Chrome extension disconnected');
        extensionSocket = null;
        // Fail all pending requests
        for (const [id, pending] of pendingRequests) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(id);
          pending.resolve({ id, error: 'Extension disconnected during operation.' });
        }
      }
    });
  });
}

async function handleCliCommand(
  cliSocket: WebSocket,
  msg: Record<string, unknown>,
  extensionSocket: WebSocket | null,
  pendingRequests: Map<string, PendingRequest>,
): Promise<void> {
  const respond = (data: Record<string, unknown>) => {
    if (cliSocket.readyState === WebSocket.OPEN) {
      cliSocket.send(JSON.stringify(data));
    }
  };

  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    respond({ error: 'Chrome extension not connected. Load the extension and verify it appears in chrome://extensions.' });
    return;
  }

  const action = msg.action as string;
  const tab = msg.tab as string | undefined;
  const output = msg.output as string | undefined;

  // If tab is a pattern, resolve it first
  let tabId: number | undefined;
  if (tab !== undefined) {
    const numericId = Number(tab);
    if (!Number.isNaN(numericId) && String(numericId) === tab) {
      tabId = numericId;
    } else {
      // Resolve by URL pattern
      const tabsResponse = await sendToExtension(extensionSocket, pendingRequests, {
        id: randomUUID(),
        action: 'list-tabs',
      });
      if ('error' in tabsResponse) {
        respond({ error: tabsResponse.error });
        return;
      }
      const tabs = (tabsResponse.result as { tabs: TabInfo[] }).tabs;
      const pattern = tab.toLowerCase();
      const matches = tabs.filter((t) => t.url.toLowerCase().includes(pattern) || t.title.toLowerCase().includes(pattern));
      if (matches.length === 0) {
        const tabList = tabs.map((t) => `  ${t.tabId} | ${t.title.slice(0, 40)} | ${t.url}`).join('\n');
        respond({ error: `No tab matching '${tab}'. Open tabs:\n${tabList}` });
        return;
      }
      if (matches.length > 1) {
        respond({ warning: `${matches.length} tabs match '${tab}'. Using: ${matches[0].title} (${matches[0].url})` });
      }
      tabId = matches[0].tabId;
    }
  }

  const request: WsRequest = {
    id: randomUUID(),
    action: action as WsRequest['action'],
    tabId: tabId ?? -1,
  };

  const response = await sendToExtension(extensionSocket, pendingRequests, request);

  if ('error' in response) {
    respond({ error: response.error });
    return;
  }

  // Handle save-page: write MHTML to disk
  if (action === 'save-page' && response.result && 'data' in response.result) {
    const saveResult = response.result as SavePageResult;
    const filePath = writeMhtml(saveResult.data, saveResult.title, output || SAVE_DIR);
    respond({ path: filePath, title: saveResult.title, url: saveResult.url });
    return;
  }

  // Handle get-text: return text directly
  if (action === 'get-text' && response.result && 'text' in response.result) {
    const textResult = response.result as GetTextResult;
    respond({ text: textResult.text, title: textResult.title, url: textResult.url });
    return;
  }

  // list-tabs or other: return as-is
  respond(response as unknown as Record<string, unknown>);
}

function sendToExtension(
  extensionSocket: WebSocket,
  pendingRequests: Map<string, PendingRequest>,
  request: WsRequest,
): Promise<WsResponse> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.id);
      resolve({ id: request.id, error: 'Extension did not respond within 15 seconds.' });
    }, 15000);

    pendingRequests.set(request.id, { resolve, timeout });
    extensionSocket.send(JSON.stringify(request));
  });
}

// --- CLI Mode ---

async function connectToServer(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    socket.on('open', () => resolve(socket));
    socket.on('error', (err) => reject(err));
  });
}

async function tryAutoStartServer(): Promise<boolean> {
  const serverScript = new URL('./server.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const child = spawn(process.execPath, ['--experimental-strip-types', serverScript, 'serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait up to 3 seconds for the server to start
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const testSocket = await connectToServer(PORT);
      testSocket.close();
      return true;
    } catch {
      // Not ready yet
    }
  }
  return false;
}

async function runCli(action: string, tab?: string, output?: string): Promise<void> {
  let socket: WebSocket;
  try {
    socket = await connectToServer(PORT);
  } catch {
    console.log('[page-save] Server not running. Starting...');
    const started = await tryAutoStartServer();
    if (!started) {
      console.error('Error: Could not start page-save server on port 7224. Run: npm run serve');
      process.exit(1);
    }
    socket = await connectToServer(PORT);
  }

  const command: Record<string, unknown> = {
    type: 'cli-command',
    action: action === 'save' ? 'save-page' : action === 'text' ? 'get-text' : action,
    tab,
    output,
  };

  socket.send(JSON.stringify(command));

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.warning) {
      console.log(`Warning: ${msg.warning}`);
    }

    if (msg.error) {
      console.error(`Error: ${msg.error}`);
      socket.close();
      process.exit(1);
    }

    if (msg.path) {
      console.log(`Saved: ${msg.path}`);
    } else if (msg.text !== undefined) {
      // Print text to stdout for Claude to read
      console.log(msg.text);
    } else if (msg.result?.tabs) {
      const tabs = msg.result.tabs as TabInfo[];
      console.log('  ID  | Title                                    | URL');
      console.log('------+------------------------------------------+----------------------------------------');
      for (const t of tabs) {
        const id = String(t.tabId).padStart(4);
        const title = t.title.slice(0, 40).padEnd(40);
        const url = t.url.slice(0, 40);
        console.log(`${id}  | ${title} | ${url}`);
      }
    } else {
      console.log(JSON.stringify(msg, null, 2));
    }

    socket.close();
    process.exit(0);
  });

  // Timeout if no response in 20 seconds
  setTimeout(() => {
    console.error('Error: Timed out waiting for response.');
    socket.close();
    process.exit(1);
  }, 20000);
}

// --- Entry Point ---

const { action, tab, output } = parseArgs(process.argv);

if (action === 'serve') {
  startServer();
} else if (['tabs', 'save', 'text'].includes(action)) {
  runCli(action, tab, output).catch((err) => {
    console.error(`Error: ${err.message || err}`);
    process.exit(1);
  });
} else {
  console.log(`Usage:
  page-save serve                                    Start WebSocket server
  page-save tabs                                     List all open Chrome tabs
  page-save save [--tab <id|pattern>] [--out <path>] Save page as MHTML
  page-save text [--tab <id|pattern>]                Extract page text`);
  process.exit(1);
}
