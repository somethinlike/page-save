/**
 * install-launcher.ts — Register the page-save native messaging host with Chrome.
 *
 * Writes the host manifest JSON to bin/com.pagesave.launcher.json, then
 * registers it under HKCU\Software\Google\Chrome\NativeMessagingHosts so
 * Chrome can find it. No admin required (HKCU = current user only).
 *
 * Usage: page-save install-launcher [--extension-id <id>] [--browser chrome|edge|brave]
 *
 * The installer auto-detects unpacked Page Save extension IDs from local
 * Chromium-family profiles. For unusual profiles, get the extension ID from
 * chrome://extensions (Developer mode on, look at the page-save card).
 */

import { writeFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';
import { detectPageSaveExtensions } from './browser-extension-discovery.ts';
import type { Browser } from './browser-extension-discovery.ts';

const HOST_NAME = 'com.pagesave.launcher';
const LAUNCH_TASK_NAME = 'PageSaveLocalServer';

interface InstallOptions {
  extensionIds: string[];
  browsers: Browser[];
}

interface RegistryTarget {
  key: string;
  view: '32' | '64';
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
  // src/install-launcher.ts → ../
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

function writeManifest(manifestPath: string, manifest: Record<string, unknown>): void {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Register the manifest path under a browser NativeMessagingHosts key.
 * On Windows, the (Default) value of the host's subkey points at the manifest JSON.
 * Uses `reg add` so we don't need a registry-binding npm package.
 */
function registerRegistryTarget(target: RegistryTarget, manifestPath: string): string {
  if (process.platform !== 'win32') {
    throw new Error(`install-launcher currently supports Windows only; got platform: ${process.platform}`);
  }
  const fullKey = `${target.key}\\${HOST_NAME}`;
  const result = spawnSync('reg', [
    'add', fullKey,
    `/reg:${target.view}`,
    '/ve',                  // (Default) value
    '/t', 'REG_SZ',
    '/d', manifestPath,
    '/f',                   // force overwrite
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

function compileCSharpExecutable(sourcePath: string, exePath: string, outputType: CSharpOutputType): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`C# launcher source missing: ${sourcePath}`);
  }
  if (!needsCompile(sourcePath, exePath)) {
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

function ensureNativeHostExecutable(root: string): string {
  const sourcePath = join(root, 'src', 'native-host-wrapper.cs');
  const exePath = join(root, 'bin', 'page-save-native-host.exe');
  compileCSharpExecutable(sourcePath, exePath, 'ConsoleApplication');
  return exePath;
}

function ensureUrlProtocolScript(root: string): string {
  const scriptPath = join(root, 'bin', 'page-save-url-launcher.vbs');
  if (!existsSync(scriptPath)) {
    throw new Error(`URL protocol launcher script missing: ${scriptPath}`);
  }
  return scriptPath;
}

function registerUrlProtocol(scriptPath: string): string[] {
  if (process.platform !== 'win32') {
    throw new Error(`URL protocol registration currently supports Windows only; got platform: ${process.platform}`);
  }

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
    registered.push(valueName ? `${key}\\${valueName}` : key);
  }

  return registered;
}

function registerLaunchTask(root: string): string {
  if (process.platform !== 'win32') {
    throw new Error(`Task Scheduler registration currently supports Windows only; got platform: ${process.platform}`);
  }

  const taskTarget = join(root, 'bin', 'page-save-server-start.bat');
  if (!existsSync(taskTarget)) {
    throw new Error(`Scheduled task target missing: ${taskTarget}`);
  }

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

export function installLauncher(options: InstallOptions): void {
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
  const nativeHostPath = ensureNativeHostExecutable(root);
  const urlLauncherPath = ensureUrlProtocolScript(root);
  const manifestPath = join(root, 'bin', `${HOST_NAME}.json`);

  // Manifest is shared across all browsers — they all read the same JSON
  // file from the same path. Only the registry pointers differ.
  const manifest = buildManifest(extensionIds, nativeHostPath);
  writeManifest(manifestPath, manifest);
  const launchTaskName = registerLaunchTask(root);

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
      registeredKeys.push({ browser, key: registerRegistryTarget(target, manifestPath) });
    } catch (err) {
      skipped.push({
        browser,
        key: `${target.key}\\${HOST_NAME} (/reg:${target.view})`,
        reason: (err as Error).message,
      });
    }
  }
  const registeredBrowsers = [...new Set(registeredKeys.map((entry) => entry.browser))];
  const protocolKeys = registerUrlProtocol(urlLauncherPath);

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
  console.log(`\nNext step: reload the page-save extension in your browser, then`);
  console.log(`click the "Launch Local Server" button when status shows offline.`);
  console.log(`If the browser was open before registration and still says "host not found", fully quit and reopen it once.`);
}
