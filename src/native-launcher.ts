/**
 * native-launcher.ts — Chrome native messaging host for spawning the page-save server.
 *
 * Speaks the stdio native-messaging protocol: 4-byte little-endian length prefix
 * followed by a JSON payload, both directions. The Chrome extension calls this
 * via chrome.runtime.sendNativeMessage('com.pagesave.launcher', { action }).
 *
 * Actions:
 *   - { action: 'status' } → { running: bool, occupied: bool, error?: string }
 *   - { action: 'start'  } → { started: bool, alreadyRunning?: bool, occupied?: bool, error?: string }
 *
 * The launcher refuses to spawn a server if the port is already in use, so a
 * non-page-save process holding 7224 won't get clobbered. If page-save is
 * already running, the launcher reports that without spawning a duplicate.
 */

import { createConnection } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { closeSync, existsSync, openSync } from 'node:fs';
import { PORT } from './types.ts';

const PROBE_TIMEOUT_MS = 750;
const POST_LAUNCH_PROBE_DELAY_MS = 1500;
const POSIX_SERVER_START_SCRIPT = 'page-save-server-start.local.sh';

interface LauncherRequest {
  action?: string;
}

interface LauncherResponse {
  [key: string]: unknown;
}

/** Probe port 7224. Returns whether a TCP listener is accepting connections. */
function probePort(): Promise<{ listening: boolean }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ listening });
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
  });
}

/**
 * Spawn the page-save server detached so it survives Chrome (and this launcher)
 * exiting. Windows goes through ShellExecute so the long-lived server is not
 * kept under the native messaging host's process tree.
 */
function spawnServerDetached(): void {
  // __dirname equivalent for ES modules under --experimental-strip-types
  const here = dirname(fileURLToPath(import.meta.url));
  const root = pathResolve(here, '..');
  const cliPath = pathResolve(here, 'cli.ts');
  const serverWindowScript = pathResolve(root, 'bin', POSIX_SERVER_START_SCRIPT);

  if ((process.platform === 'darwin' || process.platform === 'linux')
    && existsSync(serverWindowScript)
    && spawnServerWindow(root, serverWindowScript)) {
    return;
  }

  const stdoutPath = pathResolve(root, '.page-save-launched-server.out.log');
  const stderrPath = pathResolve(root, '.page-save-launched-server.err.log');

  const stdout = openSync(stdoutPath, 'a');
  const stderr = openSync(stderrPath, 'a');

  try {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', cliPath, 'serve'],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', stdout, stderr],
        windowsHide: true,
      },
    );
    child.unref();
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function spawnServerWindow(root: string, scriptPath: string): boolean {
  if (process.platform === 'darwin') {
    const command = `cd ${shellQuote(root)} && ${shellQuote(scriptPath)}`;
    const child = spawn('/usr/bin/osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  const candidates: { command: string; args: string[] }[] = [
    { command: 'x-terminal-emulator', args: ['-e', scriptPath] },
    { command: 'gnome-terminal', args: ['--', scriptPath] },
    { command: 'konsole', args: ['-e', scriptPath] },
    { command: 'xfce4-terminal', args: ['-e', scriptPath] },
    { command: 'xterm', args: ['-e', scriptPath] },
  ];

  for (const candidate of candidates) {
    if (!commandExists(candidate.command)) continue;
    const child = spawn(candidate.command, candidate.args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }

  return false;
}

function commandExists(command: string): boolean {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' });
  return result.status === 0;
}

async function handleStatus(): Promise<LauncherResponse> {
  const { listening } = await probePort();
  // We can't tell from a TCP probe alone whether the listener is page-save or
  // some unrelated process. The extension distinguishes the two by trying its
  // own WebSocket handshake; here we report 'occupied' for any listener.
  return { running: listening, occupied: listening };
}

async function handleStart(): Promise<LauncherResponse> {
  const before = await probePort();
  if (before.listening) {
    // Already running (or port blocked by something else). Either way, do not
    // spawn a duplicate — let the extension confirm via its own handshake.
    return { started: false, alreadyRunning: true, occupied: true };
  }

  try {
    spawnServerDetached();
  } catch (err) {
    return { started: false, error: (err as Error).message || String(err) };
  }

  // Give the server a beat to bind, then re-probe so the response reflects
  // reality rather than optimism.
  await new Promise((r) => setTimeout(r, POST_LAUNCH_PROBE_DELAY_MS));
  const after = await probePort();
  return { started: after.listening, alreadyRunning: false, launchAttempted: true };
}

// --- Native messaging stdio framing ---

function readMessage(): Promise<LauncherRequest | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let expected: number | null = null;

    const tryDeliver = () => {
      const buf = Buffer.concat(chunks);
      if (expected === null) {
        if (buf.length < 4) return;
        expected = buf.readUInt32LE(0);
      }
      if (expected === null) return;
      if (buf.length < 4 + expected) return;
      const payload = buf.slice(4, 4 + expected).toString('utf8');
      try {
        resolve(JSON.parse(payload) as LauncherRequest);
      } catch (err) {
        reject(err);
      }
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
    };

    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      tryDeliver();
    });
    process.stdin.on('end', () => resolve(null));
    process.stdin.on('error', reject);
  });
}

function writeMessage(obj: LauncherResponse): void {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(header);
  process.stdout.write(payload);
}

async function main(): Promise<void> {
  let req: LauncherRequest | null;
  try {
    req = await readMessage();
  } catch (err) {
    writeMessage({ error: `Bad request: ${(err as Error).message}` });
    return;
  }
  if (!req) return;

  const action = req.action || 'status';
  let resp: LauncherResponse;
  if (action === 'status') {
    resp = await handleStatus();
  } else if (action === 'start') {
    resp = await handleStart();
  } else {
    resp = { error: `Unknown action: ${action}` };
  }
  writeMessage(resp);
}

main().catch((err) => {
  writeMessage({ error: (err as Error).message || String(err) });
  process.exit(1);
});
