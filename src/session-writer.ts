import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_DIR } from './types.ts';
import { formatStructuredMarkdown, formatRawMarkdown } from './markdown-formatter.ts';
import type { ExtractionResult, StructuredResult, RawResult } from './types.ts';

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
 */
function writeRaw(session: SessionInfo, result: RawResult, index: number): string {
  const filename = sanitizeFilename(
    `${result.domain}-${index + 1}.md`
  );
  const filepath = join(session.rawDir, filename);
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
function writeManifest(session: SessionInfo, results: ExtractionResult[], files: string[]): void {
  const manifest = {
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

/**
 * Process an array of extraction results into a session folder.
 * Returns the session directory path.
 */
export function writeSession(results: ExtractionResult[]): string {
  ensureMasterReadme();
  const session = createSession();
  const files: string[] = [];

  let structuredIndex = 0;
  let rawIndex = 0;
  let hasRaw = false;

  for (const result of results) {
    if (result.type === 'structured') {
      const path = writeStructured(session, result, structuredIndex++);
      files.push(path);
    } else if (result.type === 'raw') {
      const path = writeRaw(session, result, rawIndex++);
      files.push(path);
      hasRaw = true;
    } else {
      files.push(''); // error results get no file
    }
  }

  if (hasRaw) {
    writeGuidance(session);
  }

  writeManifest(session, results, files);

  return session.dir;
}
