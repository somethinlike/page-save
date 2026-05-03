/**
 * install-launcher.ts — Register the page-save native messaging host with Chrome.
 *
 * Writes the host manifest JSON to bin/com.pagesave.launcher.json, then
 * registers it under HKCU\Software\Google\Chrome\NativeMessagingHosts so
 * Chrome can find it. No admin required (HKCU = current user only).
 *
 * Usage: page-save install-launcher --extension-id <id> [--browser chrome|edge|brave]
 *
 * Get the extension ID from chrome://extensions (Developer mode on, look at
 * the page-save card). It looks like 'abcdefghijklmnopqrstuvwxyzabcdef'.
 */

import { writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve, join } from 'node:path';

const HOST_NAME = 'com.pagesave.launcher';

type Browser = 'chrome' | 'edge' | 'brave';

interface InstallOptions {
  extensionIds: string[];
  browsers: Browser[];
}

const REGISTRY_KEYS: Record<Browser, string> = {
  chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
};

const ALL_BROWSERS: Browser[] = ['chrome', 'edge', 'brave'];

function projectRoot(): string {
  // src/install-launcher.ts → ../
  const here = dirname(fileURLToPath(import.meta.url));
  return pathResolve(here, '..');
}

function buildManifest(extensionIds: string[], batPath: string): Record<string, unknown> {
  return {
    name: HOST_NAME,
    description: 'Page Save server launcher',
    path: batPath,
    type: 'stdio',
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  };
}

function writeManifest(manifestPath: string, manifest: Record<string, unknown>): void {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Register the manifest path under the browser's NativeMessagingHosts key.
 * On Windows, the (Default) value of the host's subkey points at the manifest JSON.
 * Uses `reg add` so we don't need a registry-binding npm package.
 */
function registerInRegistry(browser: Browser, manifestPath: string): void {
  if (process.platform !== 'win32') {
    throw new Error(`install-launcher currently supports Windows only; got platform: ${process.platform}`);
  }
  const baseKey = REGISTRY_KEYS[browser];
  const fullKey = `${baseKey}\\${HOST_NAME}`;
  const result = spawnSync('reg', [
    'add', fullKey,
    '/ve',                  // (Default) value
    '/t', 'REG_SZ',
    '/d', manifestPath,
    '/f',                   // force overwrite
  ], { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`reg add failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
}

export function installLauncher(options: InstallOptions): void {
  if (!options.extensionIds || options.extensionIds.length === 0) {
    throw new Error('At least one extension ID is required. Pass --extension-id <id>.');
  }
  for (const id of options.extensionIds) {
    if (!/^[a-p]{32}$/.test(id)) {
      throw new Error(`Invalid extension ID: ${id}. Expected 32 lowercase letters a-p.`);
    }
  }
  const browsers = options.browsers && options.browsers.length > 0 ? options.browsers : ALL_BROWSERS;

  const root = projectRoot();
  const batPath = join(root, 'bin', 'page-save-launcher.bat');
  const manifestPath = join(root, 'bin', `${HOST_NAME}.json`);

  if (!existsSync(batPath)) {
    throw new Error(`Launcher script missing: ${batPath}. Re-clone or restore bin/page-save-launcher.bat.`);
  }

  // Manifest is shared across all browsers — they all read the same JSON
  // file from the same path. Only the registry pointers differ.
  const manifest = buildManifest(options.extensionIds, batPath);
  writeManifest(manifestPath, manifest);

  const registered: Browser[] = [];
  const skipped: { browser: Browser; reason: string }[] = [];
  for (const browser of browsers) {
    try {
      registerInRegistry(browser, manifestPath);
      registered.push(browser);
    } catch (err) {
      skipped.push({ browser, reason: (err as Error).message });
    }
  }

  console.log(`Native messaging host registered for: ${registered.join(', ') || '(none)'}`);
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Launcher: ${batPath}`);
  if (registered.length > 0) {
    console.log(`  Registry keys:`);
    for (const browser of registered) {
      console.log(`    ${REGISTRY_KEYS[browser]}\\${HOST_NAME}`);
    }
  }
  if (skipped.length > 0) {
    console.log(`  Skipped: ${skipped.map((s) => `${s.browser} (${s.reason})`).join(', ')}`);
  }
  console.log(`  Allowed origins:`);
  for (const id of options.extensionIds) {
    console.log(`    chrome-extension://${id}/`);
  }
  console.log(`\nNext step: reload the page-save extension in your browser, then`);
  console.log(`click the "Launch Local Page-Save Server" button when status shows offline.`);
}
