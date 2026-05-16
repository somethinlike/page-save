import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

export type Browser = 'chrome' | 'edge' | 'brave';

export interface DetectedExtension {
  id: string;
  browser: Browser;
  profile: string;
  path: string;
  active: boolean;
  pathExists: boolean;
  pathMatchesProject: boolean;
}

interface ExtensionPreferences {
  path?: unknown;
  disable_reasons?: unknown;
  active_permissions?: { api?: unknown };
  granted_permissions?: { api?: unknown };
}

interface BrowserPreferences {
  extensions?: {
    settings?: Record<string, ExtensionPreferences>;
  };
}

const EXTENSION_ID_RE = /^[a-p]{32}$/;

function userDataRoots(): Record<Browser, string | null> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return { chrome: null, edge: null, brave: null };
  }

  return {
    chrome: join(localAppData, 'Google', 'Chrome', 'User Data'),
    edge: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    brave: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
  };
}

function readPreferences(path: string): BrowserPreferences | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BrowserPreferences;
  } catch {
    return null;
  }
}

function listPreferenceFiles(userDataRoot: string): string[] {
  if (!existsSync(userDataRoot)) return [];

  return readdirSync(userDataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const profileDir = join(userDataRoot, entry.name);
      return ['Secure Preferences', 'Preferences']
        .map((file) => join(profileDir, file))
        .filter((file) => existsSync(file));
    });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isActiveExtension(pref: ExtensionPreferences): boolean {
  const disableReasons = pref.disable_reasons;
  return !Array.isArray(disableReasons) || disableReasons.length === 0;
}

function hasNativeMessagingPermission(pref: ExtensionPreferences): boolean {
  const activeApis = asStringArray(pref.active_permissions?.api);
  const grantedApis = asStringArray(pref.granted_permissions?.api);
  return activeApis.includes('nativeMessaging') || grantedApis.includes('nativeMessaging');
}

function resolveExtensionPath(rawPath: string, profileFile: string): string {
  if (isAbsolute(rawPath)) return rawPath;
  return resolve(profileFile, '..', rawPath);
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync.native(path).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Find unpacked Page Save extension IDs in local Chromium-family profiles.
 *
 * The installer uses this as a fallback when the user does not pass
 * `--extension-id`. We include stale Page Save-looking entries too: a browser
 * can keep a previously loaded unpacked extension alive until the profile is
 * fully restarted, and adding extra extension IDs to `allowed_origins` is
 * harmless while debugging local development installs.
 */
export function detectPageSaveExtensions(projectExtensionDir: string): DetectedExtension[] {
  const projectRealPath = safeRealpath(projectExtensionDir);
  const detected: DetectedExtension[] = [];

  for (const [browser, root] of Object.entries(userDataRoots()) as [Browser, string | null][]) {
    if (!root) continue;

    for (const preferenceFile of listPreferenceFiles(root)) {
      const preferences = readPreferences(preferenceFile);
      const settings = preferences?.extensions?.settings;
      if (!settings) continue;

      for (const [id, pref] of Object.entries(settings)) {
        if (!EXTENSION_ID_RE.test(id)) continue;
        if (!isActiveExtension(pref)) continue;
        if (!hasNativeMessagingPermission(pref)) continue;
        if (typeof pref.path !== 'string') continue;

        const extensionPath = resolveExtensionPath(pref.path, preferenceFile);
        const extensionRealPath = safeRealpath(extensionPath);
        const pathExists = extensionRealPath !== null;
        const pathMatchesProject = Boolean(projectRealPath && extensionRealPath === projectRealPath);
        const pathLooksLikePageSave = extensionPath.toLowerCase().includes('page-save');

        if (!pathMatchesProject && !pathLooksLikePageSave) continue;

        detected.push({
          id,
          browser,
          profile: basename(resolve(preferenceFile, '..')),
          path: extensionPath,
          active: true,
          pathExists,
          pathMatchesProject,
        });
      }
    }
  }

  const byId = new Map<string, DetectedExtension>();
  for (const extension of detected) {
    const existing = byId.get(extension.id);
    if (!existing || (!existing.pathMatchesProject && extension.pathMatchesProject)) {
      byId.set(extension.id, extension);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
