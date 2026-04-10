import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_DIR } from './types.ts';
import { formatStructuredMarkdown, formatRawMarkdown } from './markdown-formatter.ts';
import { extractWithDefuddle } from './defuddle-extractor.ts';
import type { ExtractionResult, StructuredResult, RawResult, PageConfidence, FieldConfidence } from './types.ts';

const SESSIONS_DIR = join(SAVE_DIR, 'sessions');

// Template paths (live alongside this source file's project root)
const TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
const GUIDANCE_SOURCE = join(TEMPLATES_DIR, 'GUIDANCE.md');
const README_SOURCE = join(TEMPLATES_DIR, 'SAVED-PAGES-README.md');

export interface SessionInfo {
  dir: string;
  reducedDir: string;
  rawDir: string;
  timestamp: string;
}

/**
 * Create a new session directory with reduced/ and raw/ subdirs.
 * Timestamp format: YYYY-MM-DD_HHmm (CST approximation via local time)
 */
export function createSession(): SessionInfo {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    '-',
    String(now.getMonth() + 1).padStart(2, '0'),
    '-',
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  const dir = join(SESSIONS_DIR, timestamp);
  const reducedDir = join(dir, 'reduced');
  const rawDir = join(dir, 'raw');

  mkdirSync(reducedDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });

  return { dir, reducedDir, rawDir, timestamp };
}

/**
 * Sanitize a string for use as a filename.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
}

/**
 * Write a structured extraction result to the reduced/ directory.
 */
function writeStructured(session: SessionInfo, result: StructuredResult, index: number): string {
  const filename = sanitizeFilename(
    `${result.domain}-${result.pageType}-${index + 1}.md`
  );
  const filepath = join(session.reducedDir, filename);
  const markdown = formatStructuredMarkdown(result);
  writeFileSync(filepath, markdown, 'utf-8');
  return filepath;
}

/**
 * Write a raw text result to the raw/ directory.
 * If HTML is available, uses Defuddle for clean article extraction.
 */
async function writeRaw(session: SessionInfo, result: RawResult, index: number): Promise<string> {
  const filename = sanitizeFilename(
    `${result.domain}-${index + 1}.md`
  );
  const filepath = join(session.rawDir, filename);

  // Try Defuddle extraction if HTML is available
  if (result.html) {
    try {
      const defuddled = await extractWithDefuddle(result.html, result.url);
      if (defuddled.content && defuddled.wordCount > 50) {
        // Defuddle produced meaningful content — use it
        const header = [
          `# ${defuddled.title || result.title}`,
          `- Source: ${result.url}`,
          defuddled.author ? `- Author: ${defuddled.author}` : '',
          defuddled.description ? `- Description: ${defuddled.description}` : '',
          `- Words: ${defuddled.wordCount}`,
          '',
        ].filter(Boolean).join('\n');

        writeFileSync(filepath, header + '\n' + defuddled.content + '\n', 'utf-8');
        return filepath;
      }
    } catch {
      // Defuddle failed — fall through to raw text
    }
  }

  // Fallback: plain text output
  const markdown = formatRawMarkdown(result);
  writeFileSync(filepath, markdown, 'utf-8');
  return filepath;
}

/**
 * Copy GUIDANCE.md template into the raw/ directory if there are raw results.
 */
function writeGuidance(session: SessionInfo): void {
  const dest = join(session.rawDir, 'GUIDANCE.md');
  if (existsSync(GUIDANCE_SOURCE)) {
    copyFileSync(GUIDANCE_SOURCE, dest);
  } else {
    // Inline fallback if template file is missing
    writeFileSync(dest, [
      '# AI Guidance for Raw Pages',
      '',
      'These pages did not match any known extraction schema.',
      'The full page text is preserved as-is.',
      '',
      '## What to extract',
      '- Product name / title',
      '- Price (current, original, discount)',
      '- Rating and review count',
      '- Key specifications or features',
      '- Availability / shipping info',
      '',
      '## Proposing a new schema',
      'If you see a consistent pattern across multiple raw pages from the same domain,',
      'you can propose a new schema. See `schemas/_template.json` in the page-save project',
      'for the format specification.',
      '',
    ].join('\n'), 'utf-8');
  }
}

/**
 * Write a session manifest listing all saved pages.
 */
function writeManifest(
  session: SessionInfo,
  results: ExtractionResult[],
  files: string[],
  confidence: PageConfidence[],
): void {
  const manifest: Record<string, unknown> = {
    timestamp: session.timestamp,
    totalPages: results.length,
    reduced: results.filter(r => r.type === 'structured').length,
    raw: results.filter(r => r.type === 'raw').length,
    errors: results.filter(r => r.type === 'error').length,
    pages: results.map((r, i) => ({
      type: r.type,
      domain: 'domain' in r ? r.domain : undefined,
      url: 'url' in r ? r.url : undefined,
      title: 'title' in r ? r.title : undefined,
      file: files[i] || null,
    })),
  };

  if (confidence.length > 0) {
    manifest.confidence = confidence;
  }

  writeFileSync(
    join(session.dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
}

/**
 * Ensure the master README.md exists in the saved-pages root.
 * Generated on first session creation.
 */
function ensureMasterReadme(): void {
  const dest = join(SAVE_DIR, 'README.md');
  if (existsSync(dest)) return;

  mkdirSync(SAVE_DIR, { recursive: true });
  if (existsSync(README_SOURCE)) {
    copyFileSync(README_SOURCE, dest);
  }
}

// --- Cross-Page Deduplication ---
// Removes duplicate items across search result pages. Same product appearing
// on page 1 and page 3 only needs to appear once. Identified by unique key
// fields (asin, listingId, itemId, sku, or title as fallback).

/** Fields that can serve as unique identifiers for dedup, in priority order */
const DEDUP_KEY_FIELDS = ['asin', 'listingId', 'itemId', 'sku'];

/**
 * Get a dedup key for an item. Returns the first non-null unique identifier,
 * or the title as fallback.
 */
function getDedupKey(item: Record<string, unknown>): string | null {
  for (const field of DEDUP_KEY_FIELDS) {
    const val = item[field];
    if (typeof val === 'string' && val.length > 0) return `${field}:${val}`;
  }
  // Fallback to title if no ID field exists
  const title = item.title;
  if (typeof title === 'string' && title.length > 0) return `title:${title}`;
  return null;
}

/**
 * Deduplicate items across all search result pages.
 * Product detail pages (single item) are never deduped.
 * Mutates the results in place — removes duplicate rows from data.items arrays.
 * Returns the number of duplicates removed.
 */
function deduplicateResults(results: ExtractionResult[]): number {
  const seen = new Set<string>();
  let removed = 0;

  for (const result of results) {
    if (result.type !== 'structured') continue;
    const { data } = result;

    // Only dedup repeating-item pages (search results), not single-item pages
    if (!data.items) continue;

    const deduped: Record<string, unknown>[] = [];
    for (const item of data.items) {
      const key = getDedupKey(item);
      if (key && seen.has(key)) {
        removed++;
        continue;
      }
      if (key) seen.add(key);
      deduped.push(item);
    }

    data.items = deduped;
    data.count = deduped.length;
  }

  return removed;
}

// --- Symbol Table (Interning) ---
// Trades local CPU cycles for API token savings by replacing repeated
// long strings with short ~XX references. Zero information loss —
// full values stored in refs.txt.

interface SymbolTable {
  /** symbol → original value */
  entries: Map<string, string>;
  /** original value → symbol (reverse lookup for replacement) */
  reverse: Map<string, string>;
}

/** Fields eligible for interning in structured results */
const INTERNABLE_FIELDS = ['title', 'url', 'brand'];

/** Minimum string length to consider for interning */
const MIN_INTERN_LENGTH = 20;

/** Minimum occurrence count to trigger interning */
const MIN_INTERN_COUNT = 2;

/**
 * Scan all structured results and build a symbol table for repeated values.
 * Only interns values that appear 2+ times and are longer than 20 chars.
 */
function buildSymbolTable(results: ExtractionResult[]): SymbolTable {
  // Count occurrences of each internable value
  const counts = new Map<string, number>();

  for (const result of results) {
    if (result.type !== 'structured') continue;
    const { data } = result;

    const items = data.items || (data.item ? [data.item] : []);
    for (const item of items) {
      for (const field of INTERNABLE_FIELDS) {
        const val = item[field];
        if (typeof val === 'string' && val.length >= MIN_INTERN_LENGTH) {
          counts.set(val, (counts.get(val) || 0) + 1);
        }
      }
    }
  }

  // Assign symbols to values that meet the threshold
  const entries = new Map<string, string>();
  const reverse = new Map<string, string>();

  const prefixCounters: Record<string, number> = { T: 0, U: 0, B: 0 };

  // Sort by count descending so most-repeated values get lowest numbers
  const candidates = [...counts.entries()]
    .filter(([_, count]) => count >= MIN_INTERN_COUNT)
    .sort((a, b) => b[1] - a[1]);

  for (const [value] of candidates) {
    // Determine prefix based on what the value looks like
    let prefix: string;
    if (value.includes('/dp/') || value.includes('.com/') || value.startsWith('http')) {
      prefix = 'U';
    } else if (value.length < 40 && !value.includes(',')) {
      prefix = 'B'; // short, no commas = likely brand name
    } else {
      prefix = 'T'; // long text = likely title
    }

    prefixCounters[prefix]++;
    const symbol = `~${prefix}${prefixCounters[prefix]}`;
    entries.set(symbol, value);
    reverse.set(value, symbol);
  }

  return { entries, reverse };
}

/**
 * Replace internable field values in extraction results with their symbols.
 * Mutates the results in place.
 */
function applySymbols(results: ExtractionResult[], table: SymbolTable): void {
  if (table.reverse.size === 0) return;

  for (const result of results) {
    if (result.type !== 'structured') continue;
    const { data } = result;

    const items = data.items || (data.item ? [data.item] : []);
    for (const item of items) {
      for (const field of INTERNABLE_FIELDS) {
        const val = item[field];
        if (typeof val === 'string') {
          const symbol = table.reverse.get(val);
          if (symbol) {
            item[field] = symbol;
          }
        }
      }
    }
  }
}

/**
 * Write refs.txt to the session directory.
 */
function writeRefsFile(session: SessionInfo, table: SymbolTable): void {
  if (table.entries.size === 0) return;

  const lines: string[] = [
    '# Symbol Table — interned references for token reduction',
    '# Format: ~PREFIX_NUMBER=original_value',
    '# ~T = title, ~U = URL, ~B = brand',
    '',
  ];

  for (const [symbol, value] of table.entries) {
    lines.push(`${symbol}=${value}`);
  }

  writeFileSync(join(session.dir, 'refs.txt'), lines.join('\n') + '\n', 'utf-8');
}

// --- Confidence Scoring ---
// Per-field population rates for structured results. Surfaces broken selectors
// instantly — when a field starts returning nulls, the confidence rate drops.

/**
 * Compute per-field confidence scores for structured extraction results.
 * Groups by domain+pageType, then counts populated vs null for each field.
 */
function computeConfidence(results: ExtractionResult[]): PageConfidence[] {
  // Group structured results by domain+pageType
  const groups = new Map<string, StructuredResult[]>();

  for (const result of results) {
    if (result.type !== 'structured') continue;
    const key = `${result.domain}::${result.pageType}`;
    const group = groups.get(key);
    if (group) group.push(result);
    else groups.set(key, [result]);
  }

  const confidence: PageConfidence[] = [];

  for (const [key, group] of groups) {
    const [domain, pageType] = key.split('::');

    // Collect all items across pages in this group
    const allItems: Record<string, unknown>[] = [];
    for (const result of group) {
      const { data } = result;
      if (data.items) allItems.push(...data.items);
      else if (data.item) allItems.push(data.item);
    }

    if (allItems.length === 0) continue;

    // Discover all fields from the items
    const fieldNames = new Set<string>();
    for (const item of allItems) {
      for (const key of Object.keys(item)) {
        fieldNames.add(key);
      }
    }

    // Compute per-field population rate
    const total = allItems.length;
    const fields: FieldConfidence[] = [];

    for (const field of fieldNames) {
      let populated = 0;
      for (const item of allItems) {
        const val = item[field];
        if (val !== null && val !== undefined && val !== '') {
          populated++;
        }
      }
      fields.push({
        field,
        total,
        populated,
        rate: Math.round((populated / total) * 1000) / 1000,
      });
    }

    // Sort fields: lowest rate first (broken selectors surface at top)
    fields.sort((a, b) => a.rate - b.rate);

    const totalPopulated = fields.reduce((sum, f) => sum + f.populated, 0);
    const totalPossible = fields.reduce((sum, f) => sum + f.total, 0);
    const overallRate = totalPossible > 0
      ? Math.round((totalPopulated / totalPossible) * 1000) / 1000
      : 0;

    confidence.push({ domain, pageType, fields, overallRate });
  }

  return confidence;
}

/**
 * Process an array of extraction results into a session folder.
 * Returns the session directory path.
 */
export async function writeSession(results: ExtractionResult[]): Promise<string> {
  ensureMasterReadme();
  const session = createSession();

  // 1. Deduplicate across pages (same product on multiple search pages → keep first)
  const dupsRemoved = deduplicateResults(results);

  // 2. Compute confidence scores (after dedup, before interning mutates values)
  const confidence = computeConfidence(results);

  // 3. Build symbol table and apply interning
  const symbolTable = buildSymbolTable(results);
  applySymbols(results, symbolTable);
  writeRefsFile(session, symbolTable);

  const files: string[] = [];

  let structuredIndex = 0;
  let rawIndex = 0;
  let hasRaw = false;

  for (const result of results) {
    if (result.type === 'structured') {
      const path = writeStructured(session, result, structuredIndex++);
      files.push(path);
    } else if (result.type === 'raw') {
      const path = await writeRaw(session, result, rawIndex++);
      files.push(path);
      hasRaw = true;
    } else {
      files.push(''); // error results get no file
    }
  }

  if (hasRaw) {
    writeGuidance(session);
  }

  writeManifest(session, results, files, confidence);

  return session.dir;
}
