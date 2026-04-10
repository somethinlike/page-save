/**
 * diff.ts — Compare extraction results across snapshots
 *
 * Used by watch/monitoring to detect changes (price drops, new items,
 * removed items) and by delta mode to annotate repeat extractions.
 */

import type { DiffResult, DiffChange } from './types.ts';

/**
 * Get a unique key for an item. Uses common ID fields, falls back to title.
 */
function getItemKey(item: Record<string, unknown>): string | null {
  for (const field of ['asin', 'listingId', 'itemId', 'sku', 'videoId']) {
    const val = item[field];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  const title = item.title;
  if (typeof title === 'string' && title.length > 0) return `title:${title}`;
  return null;
}

/**
 * Diff two arrays of items. Identifies added, removed, changed, and unchanged items.
 *
 * @param prev - Previous snapshot items
 * @param curr - Current snapshot items
 * @param watchFields - Optional list of fields to track for changes (default: all)
 */
export function diffItems(
  prev: Record<string, unknown>[],
  curr: Record<string, unknown>[],
  watchFields?: string[],
): DiffResult {
  const prevMap = new Map<string, Record<string, unknown>>();
  for (const item of prev) {
    const key = getItemKey(item);
    if (key) prevMap.set(key, item);
  }

  const currMap = new Map<string, Record<string, unknown>>();
  for (const item of curr) {
    const key = getItemKey(item);
    if (key) currMap.set(key, item);
  }

  const added: Record<string, unknown>[] = [];
  const changed: { item: Record<string, unknown>; changes: DiffChange[] }[] = [];
  let unchanged = 0;

  for (const [key, currItem] of currMap) {
    const prevItem = prevMap.get(key);
    if (!prevItem) {
      added.push(currItem);
      continue;
    }

    // Compare fields
    const changes = diffSingleItem(prevItem, currItem, watchFields);
    if (changes.length > 0) {
      changed.push({ item: currItem, changes });
    } else {
      unchanged++;
    }
  }

  // Items in prev but not in curr
  const removed: Record<string, unknown>[] = [];
  for (const [key, prevItem] of prevMap) {
    if (!currMap.has(key)) {
      removed.push(prevItem);
    }
  }

  return { added, removed, changed, unchanged };
}

/**
 * Compare two single items field-by-field.
 * Returns an array of changed fields.
 */
export function diffSingleItem(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
  watchFields?: string[],
): DiffChange[] {
  const fields = watchFields || [...new Set([...Object.keys(prev), ...Object.keys(curr)])];
  const changes: DiffChange[] = [];

  for (const field of fields) {
    const prevVal = prev[field];
    const currVal = curr[field];

    // Normalize for comparison: stringify arrays/objects
    const prevStr = typeof prevVal === 'object' ? JSON.stringify(prevVal) : String(prevVal ?? '');
    const currStr = typeof currVal === 'object' ? JSON.stringify(currVal) : String(currVal ?? '');

    if (prevStr !== currStr) {
      changes.push({ field, prev: prevVal, curr: currVal });
    }
  }

  return changes;
}

/**
 * Format a diff result as a human-readable summary.
 */
export function formatDiffSummary(diff: DiffResult): string {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push(`NEW: ${diff.added.length} item(s)`);
    for (const item of diff.added) {
      lines.push(`  + ${item.title || item.asin || JSON.stringify(item).slice(0, 60)}`);
    }
  }

  if (diff.removed.length > 0) {
    lines.push(`REMOVED: ${diff.removed.length} item(s)`);
    for (const item of diff.removed) {
      lines.push(`  - ${item.title || item.asin || JSON.stringify(item).slice(0, 60)}`);
    }
  }

  if (diff.changed.length > 0) {
    lines.push(`CHANGED: ${diff.changed.length} item(s)`);
    for (const { item, changes } of diff.changed) {
      const label = item.title || item.asin || 'unknown';
      const changeSummary = changes.map(c => `${c.field}: ${c.prev} → ${c.curr}`).join(', ');
      lines.push(`  ~ ${label}: ${changeSummary}`);
    }
  }

  if (diff.unchanged > 0) {
    lines.push(`UNCHANGED: ${diff.unchanged} item(s)`);
  }

  return lines.join('\n');
}
