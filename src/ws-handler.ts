import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { PORT } from './types.ts';
import type { WsRequest, WsResponse, TabInfo, SavePageResult, GetTextResult, ExtractionResult, BatchResult, DomProbeResult, YoutubeHtmlResult } from './types.ts';
import { writeMhtml } from './file-writer.ts';
import { writeSession, writeSessionWithDelta, writeYoutubeSession, openSession, appendToSession, finalizeSession, getSessionStatus } from './session-writer.ts';
import { generateSchema, formatSchemaSummary, saveSchema } from './schema-suggest.ts';
import { extractSubtitles } from './youtube-extractor.ts';
import { createWatch, listWatches, processWatchResult } from './watch.ts';
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

  // --- session-start: open an accumulating session ---
  if (action === 'session-start') {
    try {
      const sessionId = openSession();
      respond({ sessionId, message: `Session ${sessionId} started. Use session-add to add pages.` });
    } catch (err) {
      respond({ error: (err as Error).message });
    }
    return;
  }

  // --- session-add: add extraction to the active session ---
  if (action === 'session-add') {
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
    try {
      const status = appendToSession([result]);
      respond({ ...status, ...(warning && { warning }) });
    } catch (err) {
      respond({ error: (err as Error).message });
    }
    return;
  }

  // --- session-finalize: write accumulated session to disk ---
  if (action === 'session-finalize') {
    try {
      const sessionDir = await finalizeSession();
      respond({ sessionDir, message: 'Session finalized.' });
    } catch (err) {
      respond({ error: (err as Error).message });
    }
    return;
  }

  // --- session-status: check active session ---
  if (action === 'session-status') {
    respond(getSessionStatus());
    return;
  }

  // --- watch-add: create a new watch configuration ---
  if (action === 'watch-add') {
    const url = msg.url as string | undefined;
    if (!url) {
      respond({ error: 'No URL provided. Use --url.' });
      return;
    }
    const fields = msg.fields as string[] | undefined;
    const config = createWatch(url, fields);
    respond({ watchId: config.id, url: config.url, fields: config.fields });
    return;
  }

  // --- watch-list: list all watch configurations ---
  if (action === 'watch-list') {
    const watches = listWatches();
    respond({ watches, count: watches.length });
    return;
  }

  // --- watch-run: re-extract a watch target and diff against previous ---
  if (action === 'watch-run') {
    const watchId = msg.watchId as string | undefined;
    const runAll = msg.all === true;

    const watches = listWatches();
    const targets = runAll ? watches : watches.filter(w => w.id === watchId);

    if (targets.length === 0) {
      respond({ error: watchId ? `Watch ${watchId} not found.` : 'No watches configured.' });
      return;
    }

    const results = [];
    for (const watch of targets) {
      // Use batch-urls to extract the watch URL
      const request: WsRequest = {
        id: randomUUID(),
        action: 'batch-urls',
        urls: [watch.url],
      };

      const response = await sendToExtension(extensionSocket, pendingRequests, request, 30000);
      if ('error' in response) {
        results.push({ watchId: watch.id, error: (response as { error: string }).error });
        continue;
      }

      const batchResult = response.result as BatchResult;
      const extractionResults = batchResult.results as ExtractionResult[];

      // Collect items from extraction results
      const items: Record<string, unknown>[] = [];
      for (const r of extractionResults) {
        if (r.type === 'structured' && r.data) {
          if (r.data.items) items.push(...r.data.items);
          else if (r.data.item) items.push(r.data.item);
        }
      }

      try {
        const { diff, summary, snapshotPath } = processWatchResult(watch.id, items);
        results.push({ watchId: watch.id, url: watch.url, summary, snapshotPath, hasChanges: diff !== null && (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) });
      } catch (err) {
        results.push({ watchId: watch.id, error: (err as Error).message });
      }
    }

    respond({ results });
    return;
  }

  // --- youtube: extract transcript from a YouTube tab ---
  if (action === 'youtube') {
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
      action: 'get-youtube-html',
      tabId: resolvedTabId ?? -1,
    };

    const response = await sendToExtension(extensionSocket, pendingRequests, request, 30000);
    if ('error' in response) { respond({ error: response.error }); return; }

    const htmlResult = response.result as YoutubeHtmlResult;
    const youtubeResult = await extractSubtitles(htmlResult.html, htmlResult.url);
    const sessionDir = await writeYoutubeSession(youtubeResult);

    respond({
      sessionDir,
      videoId: youtubeResult.videoId,
      title: youtubeResult.title,
      channel: youtubeResult.channel,
      duration: youtubeResult.duration,
      language: youtubeResult.language,
      ...(warning && { warning }),
    });
    return;
  }

  // --- batch: extract from a list of URLs via background tabs ---
  if (action === 'batch') {
    const urls = msg.urls as string[] | undefined;
    if (!urls || urls.length === 0) {
      respond({ error: 'No URLs provided. Use --urls or --file.' });
      return;
    }

    const request: WsRequest = {
      id: randomUUID(),
      action: 'batch-urls',
      urls,
    };

    // 20s per URL + 5s buffer
    const timeoutMs = urls.length * 20000 + 5000;
    const response = await sendToExtension(extensionSocket, pendingRequests, request, timeoutMs);
    if ('error' in response) { respond({ error: response.error }); return; }

    const batchResult = response.result as BatchResult;
    const sessionDir = await writeSession(batchResult.results as ExtractionResult[]);
    respond({
      sessionDir,
      count: batchResult.count,
      structured: batchResult.results.filter((r: ExtractionResult) => r.type === 'structured').length,
      raw: batchResult.results.filter((r: ExtractionResult) => r.type === 'raw').length,
    });
    return;
  }

  // --- schema-suggest: probe a page's DOM and generate a draft schema ---
  if (action === 'schema-suggest') {
    let resolvedTabId: number | undefined;
    let warning: string | undefined;
    const shouldSave = msg.save === true;

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
      action: 'probe-dom',
      tabId: resolvedTabId ?? -1,
    };

    const response = await sendToExtension(extensionSocket, pendingRequests, request);
    if ('error' in response) { respond({ error: response.error }); return; }

    const probeResult = response.result as DomProbeResult;
    const schema = generateSchema(probeResult);
    const summary = formatSchemaSummary(schema);

    let savedPath: string | undefined;
    if (shouldSave) {
      const schemasDir = new URL('../schemas', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
      savedPath = saveSchema(schema, schemasDir);
    }

    respond({
      schema,
      summary,
      ...(savedPath && { savedPath }),
      ...(warning && { warning }),
    });
    return;
  }

  // --- extract-pages: paginated extraction from a single tab ---
  if (action === 'extract-pages') {
    let resolvedTabId: number | undefined;
    let warning: string | undefined;
    const maxPages = (msg.maxPages as number) || 10;

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
      action: 'get-structured-paginated',
      tabId: resolvedTabId ?? -1,
      maxPages,
    };

    // Timeout scales with page count: 15s per page + 5s buffer
    const timeoutMs = maxPages * 15000 + 5000;
    const response = await sendToExtension(extensionSocket, pendingRequests, request, timeoutMs);
    if ('error' in response) { respond({ error: response.error }); return; }

    const batchResult = response.result as BatchResult;
    const extractionResults = batchResult.results as ExtractionResult[];
    const prevSession = msg.prev as string | undefined;
    const sessionDir = prevSession
      ? await writeSessionWithDelta(extractionResults, prevSession)
      : await writeSession(extractionResults);
    respond({
      sessionDir,
      count: batchResult.count,
      structured: batchResult.results.filter((r: ExtractionResult) => r.type === 'structured').length,
      raw: batchResult.results.filter((r: ExtractionResult) => r.type === 'raw').length,
      delta: !!prevSession,
      ...(warning && { warning }),
    });
    return;
  }

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
    const extractionResults = batchResult.results as ExtractionResult[];
    const prevSession = msg.prev as string | undefined;
    const sessionDir = prevSession
      ? await writeSessionWithDelta(extractionResults, prevSession)
      : await writeSession(extractionResults);
    respond({
      sessionDir,
      count: batchResult.count,
      structured: batchResult.results.filter((r: ExtractionResult) => r.type === 'structured').length,
      raw: batchResult.results.filter((r: ExtractionResult) => r.type === 'raw').length,
      delta: !!prevSession,
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
    const sessionDir = await writeSession([result]);
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

    socket.on('message', async (raw) => {
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
          const sessionDir = await writeSession(results);
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
