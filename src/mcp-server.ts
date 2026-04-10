/**
 * mcp-server.ts — MCP server entry point for page-save
 *
 * Exposes page-save tools natively in Claude Desktop, Claude Code,
 * and any MCP client. Communicates with the Node.js bridge server
 * via WebSocket (same as the CLI client).
 *
 * Architecture:
 *   Claude Desktop ──stdio──► MCP Server ──ws://7224──► Node.js Server ──ws──► Chrome Extension
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { PORT } from './types.ts';

// --- WebSocket Client ---

let ws: WebSocket | null = null;

function ensureConnection(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve(ws);
      return;
    }

    const socket = new WebSocket(`ws://localhost:${PORT}`);
    socket.on('open', () => {
      ws = socket;
      resolve(socket);
    });
    socket.on('error', (err) => {
      reject(new Error(`Cannot connect to page-save server on port ${PORT}. Start it with: page-save serve`));
    });
    socket.on('close', () => {
      ws = null;
    });
  });
}

function sendCommand(command: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
  return new Promise(async (resolve, reject) => {
    try {
      const socket = await ensureConnection();
      const timer = setTimeout(() => {
        reject(new Error('Command timed out'));
      }, timeoutMs);

      const handler = (raw: Buffer) => {
        clearTimeout(timer);
        socket.off('message', handler);
        const msg = JSON.parse(raw.toString());
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg);
        }
      };

      socket.on('message', handler);
      socket.send(JSON.stringify({ type: 'cli-command', ...command }));
    } catch (err) {
      reject(err);
    }
  });
}

// --- MCP Server ---

const server = new McpServer({
  name: 'page-save',
  version: '1.0.0',
});

// --- Tools ---

server.tool(
  'list_tabs',
  'List all open Chrome tabs',
  {},
  async () => {
    const result = await sendCommand({ action: 'list-tabs' });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.result, null, 2) }] };
  }
);

server.tool(
  'extract',
  'Extract structured data from a single tab (uses schema if available, Defuddle fallback for raw)',
  { tab: z.string().describe('Tab ID or URL/title pattern to match') },
  async ({ tab }) => {
    const result = await sendCommand({ action: 'get-structured', tab });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'extract_all',
  'Batch structured extraction from all tabs matching a domain',
  { domain: z.string().optional().describe('Domain pattern to filter tabs (e.g. "amazon.com")') },
  async ({ domain }) => {
    const result = await sendCommand({ action: 'extract-all', domain });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'extract_pages',
  'Paginated extraction — follow "next" links across search result pages from a single tab',
  {
    tab: z.string().describe('Tab ID or URL/title pattern to match'),
    maxPages: z.number().optional().default(10).describe('Maximum pages to extract (default 10)'),
  },
  async ({ tab, maxPages }) => {
    const timeoutMs = (maxPages || 10) * 15000 + 10000;
    const result = await sendCommand({ action: 'extract-pages', tab, maxPages }, timeoutMs);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'batch_urls',
  'Extract from a list of URLs by opening background tabs',
  { urls: z.array(z.string()).describe('List of URLs to extract from') },
  async ({ urls }) => {
    const timeoutMs = urls.length * 20000 + 10000;
    const result = await sendCommand({ action: 'batch', urls }, timeoutMs);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'schema_suggest',
  'Probe a page\'s DOM and generate a draft extraction schema',
  {
    tab: z.string().describe('Tab ID or URL/title pattern to match'),
    save: z.boolean().optional().default(false).describe('Save draft schema to schemas/ directory'),
  },
  async ({ tab, save }) => {
    const result = await sendCommand({ action: 'schema-suggest', tab, save });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'youtube_transcript',
  'Extract transcript/subtitles from a YouTube video tab',
  { tab: z.string().describe('Tab ID or URL/title pattern matching a YouTube tab') },
  async ({ tab }) => {
    const result = await sendCommand({ action: 'youtube', tab }, 30000);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
