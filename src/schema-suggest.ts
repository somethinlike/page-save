/**
 * schema-suggest.ts — Generate draft schemas from DOM probe results
 *
 * Takes the output of probeDomStructure() and produces a JSON schema
 * following the existing schema format (see schemas/_template.json).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomProbeResult, DomProbeCandidate } from './types.ts';

interface DraftSchema {
  domain: string;
  version: string;
  status: string;
  description: string;
  pages: Record<string, {
    urlPattern: string;
    description: string;
    container: string;
    fields: Record<string, { selector: string; type: string }>;
  }>;
}

/**
 * Derive a URL pattern from a full URL.
 * Extracts the path up to the first query param or meaningful segment.
 * @internal exported for testing
 */
export function deriveUrlPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const search = parsed.search;

    // If there's a query string, use the path + first query key
    if (search) {
      const firstParam = search.split('&')[0];
      return path + firstParam;
    }

    // Otherwise use the path (first 2 segments)
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return '/' + segments.slice(0, 2).join('/');
    }
    return path || '/';
  } catch {
    return '/';
  }
}

/**
 * Guess the page type from the URL and probe context.
 * @internal exported for testing
 */
export function guessPageType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('search') || lower.includes('/s?') || lower.includes('query=') || lower.includes('keyword=')) {
    return 'search';
  }
  if (lower.includes('/product') || lower.includes('/dp/') || lower.includes('/item/')) {
    return 'product';
  }
  if (lower.includes('/category') || lower.includes('/browse') || lower.includes('/c/')) {
    return 'category';
  }
  return 'search';
}

/**
 * Deduplicate field names — if multiple fields get the same guessed name,
 * append a numeric suffix.
 */
function deduplicateFieldNames(fields: { name: string; selector: string; type: string }[]): { name: string; selector: string; type: string }[] {
  const counts = new Map<string, number>();
  return fields.map((f) => {
    const count = counts.get(f.name) || 0;
    counts.set(f.name, count + 1);
    return {
      ...f,
      name: count > 0 ? `${f.name}${count + 1}` : f.name,
    };
  });
}

/**
 * Score a candidate container based on field quality and count.
 * Higher is better.
 * @internal exported for testing
 */
export function scoreCandidate(candidate: DomProbeCandidate): number {
  let score = 0;

  // More fields = better
  score += candidate.sampleFields.length * 10;

  // Named fields (not generic "text") are more valuable
  const named = candidate.sampleFields.filter(f => f.name !== 'text');
  score += named.length * 5;

  // Moderate item count is ideal (5-50 items)
  if (candidate.count >= 5 && candidate.count <= 50) score += 20;
  else if (candidate.count >= 3) score += 10;

  // Penalize very high count (likely layout noise)
  if (candidate.count > 100) score -= 20;

  return score;
}

/**
 * Generate a draft schema from DOM probe results.
 * Uses the top-scoring candidate as the container.
 */
export function generateSchema(probe: DomProbeResult): DraftSchema {
  const domain = probe.domain.replace(/^www\./, '');
  const pageType = guessPageType(probe.url);
  const urlPattern = deriveUrlPattern(probe.url);

  // Score and pick best candidate
  const scored = probe.candidates
    .map(c => ({ candidate: c, score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.candidate;

  if (!best) {
    return {
      domain,
      version: '1',
      status: 'draft',
      description: `${domain} — auto-generated schema (no candidates found)`,
      pages: {
        [pageType]: {
          urlPattern,
          description: 'Auto-generated — no repeating patterns detected',
          container: 'MANUAL_SELECTOR_NEEDED',
          fields: {},
        },
      },
    };
  }

  // Build fields from the best candidate
  const dedupedFields = deduplicateFieldNames(best.sampleFields);
  const fields: Record<string, { selector: string; type: string }> = {};
  for (const f of dedupedFields) {
    fields[f.name] = { selector: f.selector, type: f.type };
  }

  return {
    domain,
    version: '1',
    status: 'draft',
    description: `${domain} — auto-generated draft schema`,
    pages: {
      [pageType]: {
        urlPattern,
        description: `Auto-generated from ${best.count} repeating elements`,
        container: best.selector,
        fields,
      },
    },
  };
}

/**
 * Format a draft schema as a human-readable summary.
 */
export function formatSchemaSummary(schema: DraftSchema): string {
  const lines: string[] = [];
  lines.push(`Schema: ${schema.domain} (${schema.status})`);
  lines.push('');

  for (const [pageType, page] of Object.entries(schema.pages)) {
    lines.push(`  Page: ${pageType}`);
    lines.push(`  URL pattern: ${page.urlPattern}`);
    lines.push(`  Container: ${page.container}`);
    lines.push(`  Fields:`);
    for (const [name, def] of Object.entries(page.fields)) {
      lines.push(`    ${name}: ${def.selector} (${def.type})`);
    }
  }

  return lines.join('\n');
}

/**
 * Save a draft schema to disk.
 */
export function saveSchema(schema: DraftSchema, schemasDir: string): string {
  const filename = `${schema.domain}.json`;
  const filepath = join(schemasDir, filename);
  writeFileSync(filepath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
  return filepath;
}
