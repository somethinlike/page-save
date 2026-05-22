/**
 * install-launcher.ts — Register the Page Save native messaging host.
 *
 * Windows uses the Chromium registry NativeMessagingHosts keys plus a
 * page-save:// URL protocol handler backed by a per-user scheduled task.
 * macOS and Linux install the host manifest JSON into each browser's
 * NativeMessagingHosts directory and use the native host to open a local
 * server terminal window.
 *
 * Usage:
 *   page-save setup [--extension-id <id>] [--browser chrome|edge|brave] [--dry-run]
 *   page-save install-launcher [--extension-id <id>] [--browser chrome|edge|brave] [--dry-run]
 */

import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';
import { detectPageSaveExtensions } from './browser-extension-discovery.ts';
import type { Browser } from './browser-extension-discovery.ts';

const HOST_NAME = 'com.pagesave.launcher';
const LAUNCH_TASK_NAME = 'PageSaveLocalServer';
const POSIX_NATIVE_HOST_SCRIPT = 'page-save-native-host.sh';
const POSIX_SERVER_START_SCRIPT = 'page-save-server-start.local.sh';

interface InstallOptions {
  extensionIds: string[];
  browsers: Browser[];
  dryRun?: boolean;
}

interface RegistryTarget {
  key: string;
  view: '32' | '64';
}

interface PosixManifestTarget {
  browser: Browser | 'chromium';
  dir: string;
}

type CSharpOutputType = 'ConsoleApplication';

const REGISTRY_TARGETS: Record<Browser, RegistryTarget[]> = {
  chrome: [
    { key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts', view: '64' },
    { key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts', view: '32' },
  ],
  edge: [
    { key: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts', view: '64' },
    { key: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts', view: '32' },
  ],
  brave: [
    { key: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts', view: '64' },
    { key: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts', view: '32' },
    { key: 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts', view: '64' },
    { key: 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts', view: '32' },
    { key: 'HKCU\\Software\\Brave-Browser\\NativeMessagingHosts', view: '64' },
    { key: 'HKCU\\Software\\Brave-Browser\\NativeMessagingHosts', view: '32' },
  ],
};

const CHROMIUM_FALLBACK_TARGETS: RegistryTarget[] = [
  { key: 'HKCU\\Software\\Chromium\\NativeMessagingHosts', view: '64' },
  { key: 'HKCU\\Software\\Chromium\\NativeMessagingHosts', view: '32' },
];

const ALL_BROWSERS: Browser[] = ['chrome', 'edge', 'brave'];

function projectRoot(): string {
  // src/install-launcher.ts -> ../
  const here = dirname(fileURLToPath(import.meta.url));
  return pathResolve(here, '..');
}

function projectExtensionDir(): string {
  return join(projectRoot(), 'extension');
}

function buildManifest(extensionIds: string[], hostPath: string): Record<string, unknown> {
  return {
    name: HOST_NAME,
    description: 'Page Save server launcher',
    path: hostPath,
    type: 'stdio',
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  };
}

function writeManifest(manifestPath: string, manifest: Record<string, unknown>, dryRun = false): void {
  if (dryRun) return;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function writeExecutableScript(scriptPath: string, content: string, dryRun = false): void {
  if (dryRun) return;
  writeFileSync(scriptPath, content, 'utf8');
  chmodSync(scriptPath, 0o755);
}

/**
 * Register the manifest path under a browser NativeMessagingHosts key.
 * On Windows, the (Default) value of the host's subkey points at the manifest JSON.
 */
function registerRegistryTarget(target: RegistryTarget, manifestPath: string, dryRun = false): string {
  const fullKey = `${target.key}\\${HOST_NAME}`;
  if (dryRun) return `${fullKey} (/reg:${target.view}) [dry-run]`;

  const result = spawnSync('reg', [
    'add', fullKey,
    `/reg:${target.view}`,
    '/ve',
    '/t', 'REG_SZ',
    '/d', manifestPath,
    '/f',
  ], { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`reg add failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  return `${fullKey} (/reg:${target.view})`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function needsCompile(sourcePath: string, exePath: string): boolean {
  if (!existsSync(exePath)) return true;
  return statSync(sourcePath).mtimeMs > statSync(exePath).mtimeMs;
}

function compileCSharpExecutable(sourcePath: string, exePath: string, outputType: CSharpOutputType, dryRun = false): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`C# launcher source missing: ${sourcePath}`);
  }
  if (dryRun || !needsCompile(sourcePath, exePath)) {
    return;
  }

  const command = [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -Path ${powershellQuote(sourcePath)} -OutputAssembly ${powershellQuote(exePath)} -OutputType ${outputType}`,
  ].join('; ');

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0 || !existsSync(exePath)) {
    throw new Error(`C# launcher compile failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

function ensureWindowsNativeHostExecutable(root: string, dryRun = false): string {
  const sourcePath = join(root, 'src', 'native-host-wrapper.cs');
  const exePath = join(root, 'bin', 'page-save-native-host.exe');
  compileCSharpExecutable(sourcePath, exePath, 'ConsoleApplication', dryRun);
  return exePath;
}

function ensureUrlProtocolScript(root: string): string {
  const scriptPath = join(root, 'bin', 'page-save-url-launcher.vbs');
  if (!existsSync(scriptPath)) {
    throw new Error(`URL protocol launcher script missing: ${scriptPath}`);
  }
  return scriptPath;
}

function registerUrlProtocol(scriptPath: string, dryRun = false): string[] {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const wscriptPath = join(systemRoot, 'System32', 'wscript.exe');
  const protocolRoot = 'HKCU\\Software\\Classes\\page-save';
  const commandKey = `${protocolRoot}\\shell\\open\\command`;
  const iconKey = `${protocolRoot}\\DefaultIcon`;
  const commandValue = `"${wscriptPath}" "${scriptPath}" "%1"`;
  const writes: [string, string, string?][] = [
    [protocolRoot, 'URL:Page Save Launcher'],
    [protocolRoot, '', 'URL Protocol'],
    [iconKey, scriptPath],
    [commandKey, commandValue],
  ];
  const registered: string[] = [];

  for (const [key, value, valueName] of writes) {
    if (!dryRun) {
      const args = ['add', key];
      if (valueName) {
        args.push('/v', valueName);
      } else {
        args.push('/ve');
      }
      args.push('/t', 'REG_SZ', '/d', value, '/f');

      const result = spawnSync('reg', args, { stdio: 'pipe', encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`reg add failed: ${result.stderr || result.stdout || 'unknown error'}`);
      }
    }
    registered.push(valueName ? `${key}\\${valueName}` : key);
  }

  return registered;
}

function registerLaunchTask(root: string, dryRun = false): string {
  const taskTarget = join(root, 'bin', 'page-save-server-start.bat');
  if (!existsSync(taskTarget)) {
    throw new Error(`Scheduled task target missing: ${taskTarget}`);
  }
  if (dryRun) return `${LAUNCH_TASK_NAME} [dry-run]`;

  const result = spawnSync('schtasks', [
    '/Create',
    '/TN', LAUNCH_TASK_NAME,
    '/TR', taskTarget,
    '/SC', 'ONCE',
    '/ST', '00:00',
    '/SD', '2000/01/01',
    '/F',
    '/RL', 'LIMITED',
  ], { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`schtasks /Create failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  return LAUNCH_TASK_NAME;
}

function ensurePosixNativeHostScript(root: string, dryRun = false): string {
  const scriptPath = join(root, 'bin', POSIX_NATIVE_HOST_SCRIPT);
  const launcherPath = join(root, 'src', 'native-launcher.ts');
  if (!existsSync(launcherPath)) {
    throw new Error(`Native launcher source missing: ${launcherPath}`);
  }

  writeExecutableScript(scriptPath, [
    '#!/bin/sh',
    `exec ${shQuote(process.execPath)} --experimental-strip-types ${shQuote(launcherPath)}`,
    '',
  ].join('\n'), dryRun);

  return scriptPath;
}

function ensurePosixServerStartScript(root: string, dryRun = false): string {
  const scriptPath = join(root, 'bin', POSIX_SERVER_START_SCRIPT);
  const serverPort = '7224';

  writeExecutableScript(scriptPath, [
    '#!/bin/sh',
    `PROJECT_DIR=${shQuote(root)}`,
    `NODE_EXE=${shQuote(process.execPath)}`,
    'OUT_LOG="$PROJECT_DIR/.page-save-launched-server.out.log"',
    'ERR_LOG="$PROJECT_DIR/.page-save-launched-server.err.log"',
    `SERVER_PORT=${shQuote(serverPort)}`,
    '',
    'clear 2>/dev/null || true',
    'printf "%s\\n" "============================================================"',
    'printf "%s\\n" "Page Save Local Server"',
    'printf "%s\\n" "============================================================"',
    'printf "\\n"',
    'printf "%s\\n" "This terminal window is running the local Page Save bridge that"',
    'printf "%s\\n" "your Chromium browser extension talks to when you save selected"',
    'printf "%s\\n" "tabs or run structured extraction jobs."',
    'printf "\\n"',
    'printf "%s\\n" "The extension cannot write captured pages directly into your"',
    'printf "%s\\n" "Documents folder. It connects to this local Node.js process over"',
    'printf "%s\\n" "an explicit loopback WebSocket, and this server writes MHTML files,"',
    'printf "%s\\n" "markdown reductions, manifests, watch snapshots, and logs to disk."',
    'printf "\\n"',
    'printf "%s\\n" "Keep this window open while you use Page Save. Closing this"',
    'printf "%s\\n" "window stops the server, and the extension will switch back to"',
    'printf "%s\\n" "its offline Launch Local Server state until you start it again."',
    'printf "\\n"',
    'printf "%s\\n" "Connection:"',
    'printf "%s\\n" "  WebSocket URL : ws://127.0.0.1:$SERVER_PORT"',
    'printf "%s\\n" "  Port          : $SERVER_PORT"',
    'printf "\\n"',
    'printf "%s\\n" "Runtime:"',
    'printf "%s\\n" "  Project       : $PROJECT_DIR"',
    'printf "%s\\n" "  Node.js       : $NODE_EXE"',
    'printf "\\n"',
    'printf "%s\\n" "Logs:"',
    'printf "%s\\n" "  Server output : $OUT_LOG"',
    'printf "%s\\n" "  Server errors : $ERR_LOG"',
    'printf "\\n"',
    'printf "%s\\n" "The server is starting now. Normal operation may stay quiet in"',
    'printf "%s\\n" "this window because detailed output is appended to the log files."',
    'printf "%s\\n" "Page Save is available as long as this window remains open."',
    'printf "\\n"',
    'printf "%s\\n" "To stop Page Save, close this window or press Ctrl+C."',
    'printf "%s\\n" "============================================================"',
    'printf "\\n"',
    '',
    'cd "$PROJECT_DIR" || exit 1',
    '"$NODE_EXE" --experimental-strip-types "$PROJECT_DIR/src/cli.ts" serve >>"$OUT_LOG" 2>>"$ERR_LOG"',
    'EXIT_CODE=$?',
    '',
    'printf "\\n"',
    'printf "%s\\n" "============================================================"',
    'printf "%s\\n" "Page Save server stopped with exit code $EXIT_CODE."',
    'printf "%s\\n" "If this was unexpected, check the log files listed above."',
    'printf "%s\\n" "Press Return to close this window."',
    'printf "%s\\n" "============================================================"',
    'read _page_save_done',
    'exit "$EXIT_CODE"',
    '',
  ].join('\n'), dryRun);

  return scriptPath;
}

function posixManifestTargets(browsers: Browser[]): PosixManifestTarget[] {
  const home = homedir();
  const browserTargets: Record<Browser, string> = process.platform === 'darwin'
    ? {
        chrome: join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        edge: join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
        brave: join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
      }
    : {
        chrome: join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
        edge: join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts'),
        brave: join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
      };
  const chromiumTarget = process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts')
    : join(home, '.config', 'chromium', 'NativeMessagingHosts');

  const targets: PosixManifestTarget[] = browsers.map((browser) => ({
    browser,
    dir: browserTargets[browser],
  }));
  targets.push({ browser: 'chromium', dir: chromiumTarget });

  const seen = new Set<string>();
  return targets.filter((target) => {
    if (seen.has(target.dir)) return false;
    seen.add(target.dir);
    return true;
  });
}

function installWindows(root: string, extensionIds: string[], browsers: Browser[], dryRun: boolean): void {
  const nativeHostPath = ensureWindowsNativeHostExecutable(root, dryRun);
  const urlLauncherPath = ensureUrlProtocolScript(root);
  const manifestPath = join(root, 'bin', `${HOST_NAME}.json`);
  const manifest = buildManifest(extensionIds, nativeHostPath);
  writeManifest(manifestPath, manifest, dryRun);
  const launchTaskName = registerLaunchTask(root, dryRun);

  const registeredKeys: { browser: Browser; key: string }[] = [];
  const skipped: { browser: Browser; key: string; reason: string }[] = [];
  const targetsToRegister = new Map<string, { browser: Browser; target: RegistryTarget }>();
  for (const browser of browsers) {
    for (const target of [...REGISTRY_TARGETS[browser], ...CHROMIUM_FALLBACK_TARGETS]) {
      const targetId = `${target.key}|${target.view}`;
      if (!targetsToRegister.has(targetId)) {
        targetsToRegister.set(targetId, { browser, target });
      }
    }
  }
  for (const { browser, target } of targetsToRegister.values()) {
    try {
      registeredKeys.push({ browser, key: registerRegistryTarget(target, manifestPath, dryRun) });
    } catch (err) {
      skipped.push({
        browser,
        key: `${target.key}\\${HOST_NAME} (/reg:${target.view})`,
        reason: (err as Error).message,
      });
    }
  }
  const registeredBrowsers = [...new Set(registeredKeys.map((entry) => entry.browser))];
  const protocolKeys = registerUrlProtocol(urlLauncherPath, dryRun);

  console.log(`Native messaging host registered for: ${registeredBrowsers.join(', ') || '(none)'}`);
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Launcher: ${nativeHostPath}`);
  console.log(`  URL protocol: page-save://start`);
  console.log(`  URL launcher: ${urlLauncherPath}`);
  console.log(`  Scheduled task: ${launchTaskName}`);
  console.log(`  URL registry keys:`);
  for (const key of protocolKeys) {
    console.log(`    ${key}`);
  }
  if (registeredKeys.length > 0) {
    console.log(`  Registry keys:`);
    for (const entry of registeredKeys) {
      console.log(`    ${entry.browser}: ${entry.key}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`  Skipped registry keys:`);
    for (const entry of skipped) {
      console.log(`    ${entry.browser}: ${entry.key} (${entry.reason})`);
    }
  }
}

function installPosix(root: string, extensionIds: string[], browsers: Browser[], dryRun: boolean): void {
  const nativeHostPath = ensurePosixNativeHostScript(root, dryRun);
  const serverScriptPath = ensurePosixServerStartScript(root, dryRun);
  const manifest = buildManifest(extensionIds, nativeHostPath);
  const sharedManifestPath = join(root, 'bin', `${HOST_NAME}.json`);
  writeManifest(sharedManifestPath, manifest, dryRun);

  const installedManifests: { browser: Browser | 'chromium'; path: string }[] = [];
  for (const target of posixManifestTargets(browsers)) {
    const manifestPath = join(target.dir, `${HOST_NAME}.json`);
    writeManifest(manifestPath, manifest, dryRun);
    installedManifests.push({ browser: target.browser, path: manifestPath });
  }

  console.log(`Native messaging host registered for: ${installedManifests.map((entry) => entry.browser).join(', ')}`);
  console.log(`  Shared manifest copy: ${sharedManifestPath}`);
  console.log(`  Launcher: ${nativeHostPath}`);
  console.log(`  Server window script: ${serverScriptPath}`);
  console.log(`  Browser manifest files:`);
  for (const entry of installedManifests) {
    console.log(`    ${entry.browser}: ${entry.path}`);
  }
  if (process.platform === 'darwin') {
    console.log(`  Launch behavior: native messaging opens Terminal and starts the local server.`);
  } else {
    console.log(`  Launch behavior: native messaging opens an available terminal emulator, with a detached fallback in headless sessions.`);
  }
}

export function installLauncher(options: InstallOptions): void {
  const dryRun = options.dryRun === true;
  const detected = detectPageSaveExtensions(projectExtensionDir());
  const extensionIds = [...new Set([
    ...(options.extensionIds || []),
    ...detected.map((extension) => extension.id),
  ])].sort();

  if (extensionIds.length === 0) {
    throw new Error(
      'No Page Save extension ID found. Pass --extension-id <id>, or load the unpacked extension and retry.',
    );
  }

  for (const id of extensionIds) {
    if (!/^[a-p]{32}$/.test(id)) {
      throw new Error(`Invalid extension ID: ${id}. Expected 32 lowercase letters a-p.`);
    }
  }

  const browsers = options.browsers && options.browsers.length > 0 ? options.browsers : ALL_BROWSERS;
  const root = projectRoot();

  console.log(`Installing Page Save launcher for ${process.platform}${dryRun ? ' (dry run)' : ''}...`);

  if (process.platform === 'win32') {
    installWindows(root, extensionIds, browsers, dryRun);
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    installPosix(root, extensionIds, browsers, dryRun);
  } else {
    throw new Error(`install-launcher does not support ${process.platform} yet.`);
  }

  if (detected.length > 0) {
    console.log(`  Detected Page Save extension IDs:`);
    for (const extension of detected) {
      const marker = extension.pathMatchesProject ? 'current path' : 'stale/page-save path';
      console.log(`    ${extension.id} (${extension.browser}/${extension.profile}, ${marker})`);
    }
  }
  console.log(`  Allowed origins:`);
  for (const id of extensionIds) {
    console.log(`    chrome-extension://${id}/`);
  }
  console.log(`\nNext step: reload the Page Save extension in your browser, then`);
  console.log(`click the "Launch Local Server" button when status shows offline.`);
  console.log(`If the browser was open before registration and still says "host not found", fully quit and reopen it once.`);
}
