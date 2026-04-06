import type { StructuredResult, RawResult } from './types.ts';

/**
 * Format a timestamp for display in markdown headers.
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
 * Escape pipe characters in markdown table cells.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join('; ');
  return String(value).replace(/\|/g, '\\|').trim();
}

/**
 * Format a structured extraction result as markdown.
 * Uses a table for repeating items (search results), key-value pairs for single items.
 */
export function formatStructuredMarkdown(result: StructuredResult): string {
  const lines: string[] = [];
  const timestamp = formatTimestamp();

  lines.push(`# ${result.title}`);
  lines.push('');
  lines.push(`Extracted: ${timestamp} | Schema: ${result.domain}/${result.pageType} v${result.schemaVersion}`);
  lines.push(`Source: ${result.url}`);
  lines.push('');

  const { data } = result;

  if (data.error) {
    lines.push(`**Extraction error:** ${data.error}`);
    return lines.join('\n');
  }

  if (data.items && data.items.length > 0) {
    // Table format for repeating items
    const fields = Object.keys(data.items[0]);

    // Header row
    lines.push(`| # | ${fields.join(' | ')} |`);
    lines.push(`|---|${fields.map(() => '---').join('|')}|`);

    // Data rows
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const cells = fields.map(f => escapeCell(item[f]));
      lines.push(`| ${i + 1} | ${cells.join(' | ')} |`);
    }

    lines.push('');
    lines.push(`Total: ${data.count} items`);
  } else if (data.item) {
    // Key-value format for single items
    for (const [key, value] of Object.entries(data.item)) {
      if (Array.isArray(value) && value.length > 0) {
        lines.push(`**${key}:**`);
        for (const v of value) {
          lines.push(`- ${v}`);
        }
      } else if (value !== null && value !== undefined) {
        lines.push(`**${key}:** ${escapeCell(value)}`);
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
