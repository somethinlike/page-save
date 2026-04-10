/**
 * watch.ts — Price watch / monitoring CRUD
 *
 * Stores watch configurations and snapshots on disk.
 * Re-extraction uses the batch-urls system to fetch fresh data.
 *
 * Storage layout:
 *   saved-pages/watches/{id}/
 *     config.json     — watch configuration
 *     snapshots/      — timestamped extraction snapshots
 *     changes.json    — cumulative change log
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SAVE_DIR } from './types.ts';
import type { WatchConfig, DiffResult } from './types.ts';
import { diffItems, formatDiffSummary } from './diff.ts';

const WATCHES_DIR = join(SAVE_DIR, 'watches');

function ensureWatchDir(id: string): string {
  const dir = join(WATCHES_DIR, id);
  const snapshotsDir = join(dir, 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });
  return dir;
}

/**
 * Create a new watch configuration.
 */
export function createWatch(url: string, fields?: string[]): WatchConfig {
  const id = randomUUID().slice(0, 8);
  const config: WatchConfig = {
    id,
    url,
    fields,
    createdAt: new Date().toISOString(),
  };

  const dir = ensureWatchDir(id);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');

  return config;
}

/**
 * List all watch configurations.
 */
export function listWatches(): WatchConfig[] {
  if (!existsSync(WATCHES_DIR)) return [];

  const watches: WatchConfig[] = [];
  for (const entry of readdirSync(WATCHES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = join(WATCHES_DIR, entry.name, 'config.json');
    if (!existsSync(configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WatchConfig;
      watches.push(config);
    } catch {}
  }

  return watches;
}

/**
 * Get the latest snapshot for a watch.
 */
function getLatestSnapshot(watchDir: string): Record<string, unknown>[] | null {
  const snapshotsDir = join(watchDir, 'snapshots');
  if (!existsSync(snapshotsDir)) return null;

  const files = readdirSync(snapshotsDir).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) return null;

  const latest = files[files.length - 1];
  try {
    return JSON.parse(readFileSync(join(snapshotsDir, latest), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save a new snapshot for a watch.
 */
function saveSnapshot(watchDir: string, items: Record<string, unknown>[]): string {
  const snapshotsDir = join(watchDir, 'snapshots');
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  const filename = `${timestamp}.json`;
  const filepath = join(snapshotsDir, filename);
  writeFileSync(filepath, JSON.stringify(items, null, 2), 'utf-8');
  return filepath;
}

/**
 * Append a diff to the changes log.
 */
function appendChanges(watchDir: string, diff: DiffResult): void {
  const changesPath = join(watchDir, 'changes.json');
  let log: { timestamp: string; diff: DiffResult }[] = [];
  if (existsSync(changesPath)) {
    try { log = JSON.parse(readFileSync(changesPath, 'utf-8')); } catch {}
  }
  log.push({ timestamp: new Date().toISOString(), diff });
  writeFileSync(changesPath, JSON.stringify(log, null, 2), 'utf-8');
}

/**
 * Process a watch run result: save snapshot, diff against previous, log changes.
 * Returns the diff result (or null if this is the first snapshot).
 */
export function processWatchResult(
  watchId: string,
  items: Record<string, unknown>[],
): { diff: DiffResult | null; summary: string; snapshotPath: string } {
  const watchDir = join(WATCHES_DIR, watchId);
  const configPath = join(watchDir, 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(`Watch ${watchId} not found`);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WatchConfig;

  // Get previous snapshot for comparison
  const prevItems = getLatestSnapshot(watchDir);

  // Save current snapshot
  const snapshotPath = saveSnapshot(watchDir, items);

  if (!prevItems) {
    return {
      diff: null,
      summary: `First snapshot for watch ${watchId}: ${items.length} items captured`,
      snapshotPath,
    };
  }

  // Compute diff
  const diff = diffItems(prevItems, items, config.fields);
  const summary = formatDiffSummary(diff);

  // Log changes if any
  if (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) {
    appendChanges(watchDir, diff);
  }

  return { diff, summary, snapshotPath };
}
