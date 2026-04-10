import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PORT } from './types.ts';
import type { TabInfo } from './types.ts';
import { startServer } from './ws-handler.ts';

// --- Argument Parsing ---

interface CliArgs {
  action: string;
  tab?: string;
  output?: string;
  domain?: string;
  maxPages?: number;
  save?: boolean;
  urls?: string[];
  file?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const action = args[0] || 'serve';
  let tab: string | undefined;
  let output: string | undefined;
  let domain: string | undefined;
  let maxPages: number | undefined;
  let save = false;
  let urls: string[] | undefined;
  let file: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--tab' && args[i + 1]) {
      tab = args[i + 1];
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--domain' && args[i + 1]) {
      domain = args[i + 1];
      i++;
    } else if (args[i] === '--max-pages' && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--save') {
      save = true;
    } else if (args[i] === '--urls' && args[i + 1]) {
      urls = args[i + 1].split(',').map(u => u.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      file = args[i + 1];
      i++;
    }
  }

  return { action, tab, output, domain, maxPages, save, urls, file };
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
  const serverScript = new URL('./cli.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const child = spawn(process.execPath, ['--experimental-strip-types', serverScript, 'serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

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

async function runCli(cliArgs: CliArgs): Promise<void> {
  const { action, tab, output, domain, maxPages, save } = cliArgs;
  let socket: WebSocket;
  try {
    socket = await connectToServer(PORT);
  } catch {
    console.error('Error: page-save server not running on port 7224.');
    console.error('Start it manually: page-save serve');
    process.exit(1);
  }

  const actionMap: Record<string, string> = {
    save: 'save-page',
    text: 'get-text',
    tabs: 'list-tabs',
    extract: 'get-structured',
    'extract-all': 'extract-all',
    'extract-pages': 'extract-pages',
    'schema-suggest': 'schema-suggest',
    batch: 'batch',
  };

  // Resolve batch URLs from --file or --urls
  let batchUrls = cliArgs.urls;
  if (action === 'batch' && !batchUrls && cliArgs.file) {
    try {
      const content = readFileSync(cliArgs.file, 'utf-8');
      batchUrls = content.split('\n').map(l => l.trim()).filter(l => l && l.startsWith('http'));
    } catch (err) {
      console.error(`Error reading URL file: ${(err as Error).message}`);
      socket.close();
      process.exit(1);
    }
  }

  const command: Record<string, unknown> = {
    type: 'cli-command',
    action: actionMap[action] || action,
    tab,
    output,
    domain,
    maxPages,
    save,
    urls: batchUrls,
  };

  socket.send(JSON.stringify(command));

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.warning) {
      console.error(`Warning: ${msg.warning}`);
    }

    if (msg.error) {
      console.error(`Error: ${msg.error}`);
      socket.close();
      process.exit(1);
    }

    if (msg.summary) {
      // schema-suggest result
      console.log(msg.summary);
      if (msg.savedPath) {
        console.log(`\nSchema saved: ${msg.savedPath}`);
      }
      if (msg.schema) {
        console.log('\n--- Raw JSON ---');
        console.log(JSON.stringify(msg.schema, null, 2));
      }
    } else if (msg.sessionDir) {
      console.log(`Session saved: ${msg.sessionDir}`);
      if (msg.count !== undefined) {
        console.log(`  Total: ${msg.count} page(s) — ${msg.structured || 0} structured, ${msg.raw || 0} raw`);
      }
      if (msg.result) {
        const r = msg.result;
        if (r.type === 'structured' && r.data?.items) {
          console.log(`  Schema: ${r.domain}/${r.pageType} — ${r.data.count} items`);
        } else if (r.type === 'structured' && r.data?.item) {
          console.log(`  Schema: ${r.domain}/${r.pageType} — single item`);
        } else if (r.type === 'raw') {
          console.log(`  Raw text: ${r.text?.length || 0} chars from ${r.domain}`);
        }
      }
    } else if (msg.path) {
      console.log(`Saved: ${msg.path}`);
    } else if (msg.text !== undefined) {
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

  // Scale CLI timeout for long-running commands
  let cliTimeout = 20000;
  if (action === 'extract-pages') {
    cliTimeout = (maxPages || 10) * 15000 + 10000;
  } else if (action === 'batch' && batchUrls) {
    cliTimeout = batchUrls.length * 20000 + 10000;
  }

  setTimeout(() => {
    console.error('Error: Timed out waiting for response.');
    socket.close();
    process.exit(1);
  }, cliTimeout);
}

// --- Entry Point ---

const cliArgs = parseArgs(process.argv);

if (cliArgs.action === 'serve') {
  startServer();
} else if (['tabs', 'save', 'text', 'extract', 'extract-all', 'extract-pages', 'schema-suggest', 'batch'].includes(cliArgs.action)) {
  runCli(cliArgs).catch((err) => {
    console.error(`Error: ${err.message || err}`);
    process.exit(1);
  });
} else {
  console.log(`Usage:
  page-save serve                                              Start WebSocket server
  page-save tabs                                               List all open Chrome tabs
  page-save save [--tab <id|pattern>] [--out <path>]           Save page as MHTML
  page-save text [--tab <id|pattern>]                          Extract page text
  page-save extract [--tab <id|pattern>]                       Structured extraction (single tab)
  page-save extract-all [--domain <pattern>]                   Batch structured extraction
  page-save extract-pages [--tab <id|pattern>] [--max-pages N] Paginated extraction (follow next links)
  page-save schema-suggest [--tab <id|pattern>] [--save]       Probe DOM and suggest a schema
  page-save batch --file <urls.txt> | --urls <url1,url2,...>   Batch extraction from URL list`);
  process.exit(1);
}
