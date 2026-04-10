import type { StructuredResult, RawResult } from './types.ts';

/**
 * Format a timestamp for display in headers.
 */
function formatTimestamp(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time} CST`;
}

/**
 * Strip tracking parameters from URLs, keeping only the meaningful path.
 */
function cleanSourceUrl(url: string, domain: string): string {
  try {
    const parsed = new URL(url);

    if (domain === 'amazon.com') {
      const dpMatch = parsed.pathname.match(/\/dp\/([A-Z0-9]{10})/);
      if (dpMatch) return `amazon.com/dp/${dpMatch[1]}`;
      const searchParam = parsed.searchParams.get('k');
      if (searchParam) return `amazon.com/s?k=${searchParam}`;
    }

    const keepParams = ['q', 'k', 'keyword', 'searchTerm', 'query', 'kw', 'Ntt', 'd', 'st'];
    const cleanParams = new URLSearchParams();
    for (const key of keepParams) {
      const val = parsed.searchParams.get(key);
      if (val) cleanParams.set(key, val);
    }
    const qs = cleanParams.toString();
    return `${parsed.hostname}${parsed.pathname}${qs ? '?' + qs : ''}`;
  } catch {
    return url.slice(0, 120);
  }
}

// --- Compact Field Representations ---

/** Short column header names — saves tokens on every row */
const HEADER_MAP: Record<string, string> = {
  reviewCount: 'reviews',
  ratingText: 'rating',
  ratingAndReviews: 'rating',
  listingId: 'id',
  itemId: 'id',
  shipping: 'ship',
  condition: 'cond',
};

/** Fields to drop when a derivable equivalent exists in the same row */
const REDUNDANT_FIELDS: Record<string, string[]> = {
  // If 'asin' exists, 'url' is derivable (amazon.com/dp/{asin})
  asin: ['url'],
};

/**
 * Format a cell value compactly.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Y' : 'N';
  if (Array.isArray(value)) return value.join('; ');
  return String(value).trim();
}

/**
 * Determine which fields to drop from a row based on redundancy rules.
 */
function getRedundantFields(fields: string[]): Set<string> {
  const drop = new Set<string>();
  for (const [present, redundant] of Object.entries(REDUNDANT_FIELDS)) {
    if (fields.includes(present)) {
      for (const r of redundant) {
        if (fields.includes(r)) drop.add(r);
      }
    }
  }
  return drop;
}

/**
 * Format a structured extraction result.
 * Uses TSV for repeating items (search results) — more token-efficient than markdown tables.
 * Uses compact key-value pairs for single items (product detail pages).
 */
export function formatStructuredMarkdown(result: StructuredResult): string {
  const lines: string[] = [];
  const timestamp = formatTimestamp();

  lines.push(`# ${result.title}`);
  lines.push('');
  lines.push(`Extracted: ${timestamp} | Schema: ${result.domain}/${result.pageType} v${result.schemaVersion}`);
  lines.push(`Source: ${cleanSourceUrl(result.url, result.domain)}`);
  lines.push('');

  const { data } = result;

  if (data.error) {
    lines.push(`Error: ${data.error}`);
    return lines.join('\n');
  }

  if (data.items && data.items.length > 0) {
    // TSV format for repeating items — much more compact than markdown tables
    const allFields = Object.keys(data.items[0]);
    const redundant = getRedundantFields(allFields);
    const fields = allFields.filter(f => !redundant.has(f) && f !== '__delta');

    // Check if delta annotations are present
    const hasDelta = data.items.some(item => '__delta' in item);

    // Header row with compact names
    const headers = fields.map(f => HEADER_MAP[f] || f);
    if (hasDelta) headers.unshift('delta');
    lines.push(headers.join('\t'));

    // Data rows
    for (const item of data.items) {
      const cells = fields.map(f => formatCell(item[f]));
      if (hasDelta) cells.unshift(formatCell(item.__delta));
      lines.push(cells.join('\t'));
    }

    lines.push('');
    lines.push(`${data.count} items`);
  } else if (data.item) {
    // Compact key-value for single items
    const allFields = Object.keys(data.item);
    const redundant = getRedundantFields(allFields);

    for (const [key, value] of Object.entries(data.item)) {
      if (redundant.has(key)) continue;
      const header = HEADER_MAP[key] || key;
      if (Array.isArray(value) && value.length > 0) {
        lines.push(`${header}:`);
        for (const v of value) {
          lines.push(`- ${v}`);
        }
      } else if (value !== null && value !== undefined) {
        lines.push(`${header}: ${formatCell(value)}`);
      }
    }
  } else {
    lines.push('No data extracted.');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format a raw text extraction result as markdown.
 */
export function formatRawMarkdown(result: RawResult): string {
  const lines: string[] = [];
  const timestamp = formatTimestamp();

  lines.push(`# ${result.title}`);
  lines.push('');
  lines.push(`Extracted: ${timestamp} | Schema: none (raw text)`);
  lines.push(`Source: ${result.url}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(result.text);
  lines.push('');

  return lines.join('\n');
}
