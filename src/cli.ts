import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PORT } from './types.ts';
import type { TabInfo } from './types.ts';
import { startServer } from './ws-handler.ts';
import { installLauncher } from './install-launcher.ts';

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
  url?: string;
  fields?: string[];
  watchId?: string;
  all?: boolean;
  prev?: string;
  variant?: string;
  forceRaw?: boolean;
  extensionIds?: string[];
  browsers?: ('chrome' | 'edge' | 'brave')[];
  dryRun?: boolean;
  asins?: string[];
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
  let url: string | undefined;
  let fields: string[] | undefined;
  let watchId: string | undefined;
  let all = false;
  let prev: string | undefined;
  let variant: string | undefined;
  let forceRaw = false;
  let extensionIds: string[] | undefined;
  let browsers: ('chrome' | 'edge' | 'brave')[] | undefined;
  let dryRun = false;
  let asins: string[] | undefined;

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
    } else if (args[i] === '--url' && args[i + 1]) {
      url = args[i + 1];
      i++;
    } else if (args[i] === '--fields' && args[i + 1]) {
      fields = args[i + 1].split(',').map(f => f.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--id' && args[i + 1]) {
      watchId = args[i + 1];
      i++;
    } else if (args[i] === '--all') {
      all = true;
    } else if ((args[i] === '--prev' || args[i] === '--delta') && args[i + 1]) {
      prev = args[i + 1];
      i++;
    } else if ((args[i] === '--variant' || args[i] === '--schema') && args[i + 1]) {
      const val = args[i + 1];
      if (val === 'raw') {
        forceRaw = true;
      } else {
        variant = val;
      }
      i++;
    } else if (args[i] === '--raw') {
      forceRaw = true;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--extension-id' && args[i + 1]) {
      extensionIds = (extensionIds || []).concat(args[i + 1].split(',').map(s => s.trim()).filter(Boolean));
      i++;
    } else if (args[i] === '--asins' && args[i + 1]) {
      asins = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--browser' && args[i + 1]) {
      const raw = args[i + 1].toLowerCase();
      if (raw === 'all') {
        browsers = ['chrome', 'edge', 'brave'];
      } else {
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        for (const b of parts) {
          if (b !== 'chrome' && b !== 'edge' && b !== 'brave') {
            throw new Error(`Unknown browser '${b}'. Valid: chrome, edge, brave, all (or comma-separated).`);
          }
        }
        browsers = parts as ('chrome' | 'edge' | 'brave')[];
      }
      i++;
    }
  }

  return { action, tab, output, domain, maxPages, save, urls, file, url, fields, watchId, all, prev, variant, forceRaw, extensionIds, browsers, dryRun, asins };
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
    youtube: 'youtube',
    'session-start': 'session-start',
    'session-add': 'session-add',
    'session-finalize': 'session-finalize',
    'session-status': 'session-status',
    'watch-add': 'watch-add',
    'watch-list': 'watch-list',
    'watch-run': 'watch-run',
    'probe-result-html': 'probe-result-html',
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
    url: cliArgs.url,
    fields: cliArgs.fields,
    watchId: cliArgs.watchId,
    all: cliArgs.all,
    prev: cliArgs.prev,
    variant: cliArgs.variant,
    forceRaw: cliArgs.forceRaw,
    asins: cliArgs.asins,
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

    if (msg.watchId && !msg.results) {
      // watch-add result
      console.log(`Watch created: ${msg.watchId}`);
      console.log(`  URL: ${msg.url}`);
      if (msg.fields) console.log(`  Fields: ${msg.fields.join(', ')}`);
    } else if (msg.watches !== undefined) {
      // watch-list result
      if (msg.count === 0) {
        console.log('No watches configured.');
      } else {
        for (const w of msg.watches) {
          console.log(`  ${w.id} | ${w.url} | ${w.fields?.join(',') || 'all fields'} | ${w.createdAt}`);
        }
      }
    } else if (msg.results && Array.isArray(msg.results) && msg.results[0]?.watchId) {
      // watch-run results
      for (const r of msg.results) {
        if (r.error) {
          console.log(`  ${r.watchId}: ERROR — ${r.error}`);
        } else {
          console.log(`  ${r.watchId}: ${r.summary}`);
          if (r.hasChanges) console.log(`    Changes detected!`);
        }
      }
    } else if (msg.videoId) {
      // YouTube extraction result
      console.log(`Session saved: ${msg.sessionDir}`);
      console.log(`  Video: ${msg.title}`);
      console.log(`  Channel: ${msg.channel}`);
      console.log(`  Duration: ${msg.duration}`);
      console.log(`  Language: ${msg.language}`);
    } else if (msg.summary) {
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
  } else if (action === 'watch-run') {
    cliTimeout = 60000; // watch runs can take a while
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
  // Detached Windows launches can have no interactive stdio; keep the daemon's
  // event loop explicitly referenced so it stays alive waiting for WebSockets.
  setInterval(() => undefined, 60_000);
} else if (cliArgs.action === 'install-launcher' || cliArgs.action === 'setup') {
  try {
    installLauncher({
      extensionIds: cliArgs.extensionIds || [],
      // Default to all three Chromium-based browsers when --browser isn't
      // specified. Registering a manifest in a browser the user doesn't have
      // installed is harmless (just a stale registry entry); registering for
      // ONLY chrome and silently failing on Brave/Edge users is friction.
      browsers: cliArgs.browsers || [],
      dryRun: cliArgs.dryRun,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
} else if (['tabs', 'save', 'text', 'extract', 'extract-all', 'extract-pages', 'schema-suggest', 'batch', 'youtube', 'session-start', 'session-add', 'session-finalize', 'session-status', 'watch-add', 'watch-list', 'watch-run', 'probe-result-html'].includes(cliArgs.action)) {
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
  page-save extract [--tab <id|pattern>] [--variant <name>] [--raw]    Structured extraction (single tab)
  page-save extract-all [--domain <pattern>] [--variant <name>] [--raw] Batch structured extraction
  page-save extract-pages [--tab <id|pattern>] [--max-pages N] [--variant <name>] [--raw]  Paginated extraction
  page-save batch --file <urls.txt> | --urls <url1,url2,...> [--variant <name>] [--raw]    Batch URL extraction
  page-save schema-suggest [--tab <id|pattern>] [--save]       Probe DOM and suggest a schema
  page-save youtube [--tab <id|pattern>]                       Extract YouTube video transcript
  page-save session-start                                      Start an accumulating session
  page-save session-add --tab <id|pattern>                     Add extraction to active session
  page-save session-finalize                                   Write and close active session
  page-save session-status                                     Show active session info
  page-save watch-add --url <url> [--fields price,rating]      Create a price/content watch
  page-save watch-list                                         List all watches
  page-save watch-run [--id <watchId> | --all]                 Run watch(es) and diff
  page-save setup [--extension-id <id>] [--browser <list>] [--dry-run]
                                                               Friendly alias for install-launcher.
  page-save install-launcher [--extension-id <id>] [--browser <list>] [--dry-run]
                                                               Register the native messaging host so the
                                                               extension can launch the server itself.
                                                               Auto-detects local unpacked Page Save IDs;
                                                               use --extension-id for unusual profiles.
                                                               --browser defaults to registering for all
                                                               Chromium-based browsers (chrome,edge,brave).
                                                               Pass a comma-separated list to restrict.
                                                               --dry-run prints the install targets without
                                                               writing manifests, registry keys, or tasks.`);
  process.exit(1);
}
