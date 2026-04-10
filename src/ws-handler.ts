import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { PORT } from './types.ts';
import type { WsRequest, WsResponse, TabInfo, SavePageResult, GetTextResult, ExtractionResult, BatchResult } from './types.ts';
import { writeMhtml } from './file-writer.ts';
import { writeSession } from './session-writer.ts';
import { SAVE_DIR } from './types.ts';

interface PendingRequest {
  resolve: (value: WsResponse) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 15000;

function sendToExtension(
  extensionSocket: WebSocket,
  pendingRequests: Map<string, PendingRequest>,
  request: WsRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<WsResponse> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.id);
      resolve({ id: request.id, error: `Extension did not respond within ${Math.round(timeoutMs / 1000)} seconds.` });
    }, timeoutMs);

    pendingRequests.set(request.id, { resolve, timeout });
    extensionSocket.send(JSON.stringify(request));
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
  const domain = msg.domain as string | undefined;

  // --- extract-all: batch structured extraction by domain ---
  if (action === 'extract-all') {
    const tabsResponse = await sendToExtension(extensionSocket, pendingRequests, {
      id: randomUUID(),
      action: 'list-tabs',
    });
    if ('error' in tabsResponse) {
      respond({ error: tabsResponse.error });
      return;
    }
    const allTabs = (tabsResponse.result as { tabs: TabInfo[] }).tabs;
    let targetTabs = allTabs;

    if (domain) {
      const pattern = domain.toLowerCase();
      targetTabs = allTabs.filter((t) => {
        try { return new URL(t.url).hostname.toLowerCase().includes(pattern); }
        catch { return false; }
      });
    }

    if (targetTabs.length === 0) {
      respond({ error: domain ? `No tabs matching domain '${domain}'.` : 'No open tabs.' });
      return;
    }

    const batchRequest: WsRequest = {
      id: randomUUID(),
      action: 'get-structured-batch',
      tabIds: targetTabs.map((t) => t.tabId),
    };

    const batchResponse = await sendToExtension(extensionSocket, pendingRequests, batchRequest);
    if ('error' in batchResponse) {
      respond({ error: batchResponse.error });
      return;
    }

    const batchResult = batchResponse.result as BatchResult;
    const sessionDir = writeSession(batchResult.results as ExtractionResult[]);
    respond({
      sessionDir,
      count: batchResult.count,
      structured: batchResult.results.filter((r: ExtractionResult) => r.type === 'structured').length,
      raw: batchResult.results.filter((r: ExtractionResult) => r.type === 'raw').length,
    });
    return;
  }

  // --- extract: single tab structured extraction ---
  if (action === 'get-structured') {
    let resolvedTabId: number | undefined;
    let warning: string | undefined;
    if (tab !== undefined) {
      const numericId = Number(tab);
      if (!Number.isNaN(numericId) && String(numericId) === tab) {
        resolvedTabId = numericId;
      } else {
        const tabsResponse = await sendToExtension(extensionSocket, pendingRequests, {
          id: randomUUID(),
          action: 'list-tabs',
        });
        if ('error' in tabsResponse) { respond({ error: tabsResponse.error }); return; }
        const tabs = (tabsResponse.result as { tabs: TabInfo[] }).tabs;
        const pattern = tab.toLowerCase();
        const matches = tabs.filter((t) => t.url.toLowerCase().includes(pattern) || t.title.toLowerCase().includes(pattern));
        if (matches.length === 0) {
          const tabList = tabs.map((t) => `  ${t.tabId} | ${t.title.slice(0, 40)} | ${t.url}`).join('\n');
          respond({ error: `No tab matching '${tab}'. Open tabs:\n${tabList}` });
          return;
        }
        if (matches.length > 1) {
          warning = `${matches.length} tabs match '${tab}'. Using: ${matches[0].title} (${matches[0].url})`;
        }
        resolvedTabId = matches[0].tabId;
      }
    }

    const request: WsRequest = {
      id: randomUUID(),
      action: 'get-structured',
      tabId: resolvedTabId ?? -1,
    };

    const response = await sendToExtension(extensionSocket, pendingRequests, request);
    if ('error' in response) { respond({ error: response.error }); return; }

    const result = response.result as ExtractionResult;
    const sessionDir = writeSession([result]);
    respond({ sessionDir, result, ...(warning && { warning }) });
    return;
  }

  // --- Original commands: tabs, save, text ---

  let tabId: number | undefined;
  let warning: string | undefined;
  if (tab !== undefined) {
    const numericId = Number(tab);
    if (!Number.isNaN(numericId) && String(numericId) === tab) {
      tabId = numericId;
    } else {
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
        warning = `${matches.length} tabs match '${tab}'. Using: ${matches[0].title} (${matches[0].url})`;
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

  if (action === 'save-page' && response.result && 'data' in response.result) {
    const saveResult = response.result as SavePageResult;
    const filePath = writeMhtml(saveResult.data, saveResult.title, output || SAVE_DIR);
    respond({ path: filePath, title: saveResult.title, url: saveResult.url, ...(warning && { warning }) });
    return;
  }

  if (action === 'get-text' && response.result && 'text' in response.result) {
    const textResult = response.result as GetTextResult;
    respond({ text: textResult.text, title: textResult.title, url: textResult.url, ...(warning && { warning }) });
    return;
  }

  const responseObj = response as unknown as Record<string, unknown>;
  if (warning) responseObj.warning = warning;
  respond(responseObj);
}

export function startServer(): void {
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

      // Panel-initiated session save (extraction results from sidebar)
      if (msg.type === 'panel-save-session' && msg.id && msg.results) {
        try {
          const results = msg.results as ExtractionResult[];
          const sessionDir = writeSession(results);
          const structured = results.filter((r: ExtractionResult) => r.type === 'structured').length;
          const rawCount = results.filter((r: ExtractionResult) => r.type === 'raw').length;
          console.log(`[page-save] Panel save: ${sessionDir} (${structured} structured, ${rawCount} raw)`);
          socket.send(JSON.stringify({
            id: msg.id,
            result: { sessionDir, count: results.length, structured, raw: rawCount },
          }));
        } catch (err) {
          socket.send(JSON.stringify({
            id: msg.id,
            error: `Session write failed: ${(err as Error).message || err}`,
          }));
        }
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
        for (const [id, pending] of pendingRequests) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(id);
          pending.resolve({ id, error: 'Extension disconnected during operation.' });
        }
      }
    });
  });
}
