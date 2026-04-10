import { describe, it, expect } from 'vitest';
import {
  computeConfidence,
  parseTsvFromMarkdown,
  applyDeltaAnnotations,
} from './session-writer.ts';
import type { ExtractionResult, StructuredResult } from './types.ts';

// --- Test fixtures ---

function makeStructured(
  domain: string,
  pageType: string,
  items: Record<string, unknown>[],
): StructuredResult {
  return {
    type: 'structured',
    domain,
    pageType,
    schemaVersion: '1',
    url: `https://${domain}/test`,
    title: 'Test',
    data: { items, count: items.length },
  };
}

describe('computeConfidence', () => {
  it('computes 100% confidence when all fields are populated', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { title: 'Item 1', price: '$10', rating: '4.5' },
        { title: 'Item 2', price: '$20', rating: '4.0' },
      ]),
    ];

    const confidence = computeConfidence(results);

    expect(confidence).toHaveLength(1);
    expect(confidence[0].domain).toBe('amazon.com');
    expect(confidence[0].pageType).toBe('search');
    expect(confidence[0].overallRate).toBe(1);
    for (const field of confidence[0].fields) {
      expect(field.rate).toBe(1);
      expect(field.populated).toBe(2);
      expect(field.total).toBe(2);
    }
  });

  it('computes partial confidence when some values are null', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { title: 'Item 1', price: '$10', rating: null },
        { title: 'Item 2', price: '$20', rating: '4.0' },
        { title: 'Item 3', price: null, rating: null },
      ]),
    ];

    const confidence = computeConfidence(results);
    const byField = Object.fromEntries(confidence[0].fields.map(f => [f.field, f]));

    expect(byField.title.rate).toBe(1);
    expect(byField.price.rate).toBeCloseTo(0.667, 2);
    expect(byField.rating.rate).toBeCloseTo(0.333, 2);
  });

  it('treats empty string as unpopulated', () => {
    const results: ExtractionResult[] = [
      makeStructured('test.com', 'page', [
        { title: 'Item', price: '' },
      ]),
    ];

    const confidence = computeConfidence(results);
    const priceField = confidence[0].fields.find(f => f.field === 'price');
    expect(priceField?.populated).toBe(0);
  });

  it('treats undefined as unpopulated', () => {
    const results: ExtractionResult[] = [
      makeStructured('test.com', 'page', [
        { title: 'Item', price: undefined },
      ]),
    ];

    const confidence = computeConfidence(results);
    const priceField = confidence[0].fields.find(f => f.field === 'price');
    expect(priceField?.populated).toBe(0);
  });

  it('sorts fields with lowest rate first (broken selectors surface at top)', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { title: 'A', price: '$10', rating: null, brand: null },
        { title: 'B', price: '$20', rating: '4.5', brand: null },
      ]),
    ];

    const confidence = computeConfidence(results);
    const rates = confidence[0].fields.map(f => f.rate);

    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1]);
    }
  });

  it('groups by domain+pageType independently', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [{ title: 'A' }]),
      makeStructured('amazon.com', 'product', [{ title: 'P' }]),
      makeStructured('walmart.com', 'search', [{ title: 'W' }]),
    ];

    const confidence = computeConfidence(results);
    expect(confidence).toHaveLength(3);
    const keys = confidence.map(c => `${c.domain}/${c.pageType}`).sort();
    expect(keys).toEqual(['amazon.com/product', 'amazon.com/search', 'walmart.com/search']);
  });

  it('aggregates items across multiple pages from the same domain+pageType', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [{ title: 'A' }, { title: 'B' }]),
      makeStructured('amazon.com', 'search', [{ title: 'C' }]),
    ];

    const confidence = computeConfidence(results);
    expect(confidence).toHaveLength(1);
    expect(confidence[0].fields[0].total).toBe(3);
  });

  it('handles single-item pages (product details)', () => {
    const results: ExtractionResult[] = [{
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'product',
      schemaVersion: '1',
      url: 'https://amazon.com/dp/B00',
      title: 'Product',
      data: { item: { title: 'Widget', price: '$19.99' } },
    }];

    const confidence = computeConfidence(results);
    expect(confidence[0].fields[0].total).toBe(1);
  });

  it('returns empty array when no structured results exist', () => {
    const confidence = computeConfidence([]);
    expect(confidence).toEqual([]);
  });

  it('ignores raw and error results', () => {
    const results: ExtractionResult[] = [
      { type: 'raw', domain: 'unknown.com', url: 'https://unknown.com', title: 'Raw', text: 'content' },
      { type: 'error', tabId: 1, error: 'Failed' },
    ];

    const confidence = computeConfidence(results);
    expect(confidence).toEqual([]);
  });
});

describe('parseTsvFromMarkdown', () => {
  it('parses a simple TSV table from markdown', () => {
    const md = `# Test
Extracted: 2026-04-09 | Schema: amazon.com/search v1
Source: amazon.com/s?k=test

asin\ttitle\tprice
B001\tWidget A\t$10.00
B002\tWidget B\t$20.00

2 items
`;

    const items = parseTsvFromMarkdown(md);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ asin: 'B001', title: 'Widget A', price: '$10.00' });
    expect(items[1]).toEqual({ asin: 'B002', title: 'Widget B', price: '$20.00' });
  });

  it('skips metadata lines and finds the TSV block', () => {
    const md = `# Product Listing
Extracted: 2026-04-09 13:00 CST | Schema: amazon.com/search v1
Source: amazon.com/s

title\tprice
Thing\t$5
`;

    const items = parseTsvFromMarkdown(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Thing');
  });

  it('stops at the "N items" summary line', () => {
    const md = `headers\tcol
val1\tval2
val3\tval4

5 items
extra content that should not be parsed
`;

    const items = parseTsvFromMarkdown(md);
    expect(items).toHaveLength(2);
  });

  it('returns empty array when no TSV table is found', () => {
    const md = `# Page Title

Just some prose content with no tab-separated values.
`;

    const items = parseTsvFromMarkdown(md);
    expect(items).toEqual([]);
  });

  it('handles trailing whitespace in cells', () => {
    const md = `asin\ttitle
 B001 \t Widget
`;

    const items = parseTsvFromMarkdown(md);
    expect(items[0].asin).toBe('B001');
    expect(items[0].title).toBe('Widget');
  });
});

describe('applyDeltaAnnotations', () => {
  it('annotates new items with NEW', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { asin: 'B001', title: 'Old Item', price: '$10' },
        { asin: 'B002', title: 'New Item', price: '$20' },
      ]),
    ];
    const prev = [{ asin: 'B001', title: 'Old Item', price: '$10' }];

    applyDeltaAnnotations(results, prev);

    const items = (results[0] as StructuredResult).data.items!;
    expect(items[0].__delta).toBe('');
    expect(items[1].__delta).toBe('NEW');
  });

  it('annotates changed items with CHG', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { asin: 'B001', title: 'Item', price: '$8' },
      ]),
    ];
    const prev = [{ asin: 'B001', title: 'Item', price: '$10' }];

    applyDeltaAnnotations(results, prev);

    const items = (results[0] as StructuredResult).data.items!;
    expect(items[0].__delta).toBe('CHG');
  });

  it('annotates unchanged items with empty string', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { asin: 'B001', title: 'Same', price: '$10' },
      ]),
    ];
    const prev = [{ asin: 'B001', title: 'Same', price: '$10' }];

    applyDeltaAnnotations(results, prev);

    const items = (results[0] as StructuredResult).data.items!;
    expect(items[0].__delta).toBe('');
  });

  it('handles empty previous items (first run)', () => {
    const results: ExtractionResult[] = [
      makeStructured('amazon.com', 'search', [
        { asin: 'B001', title: 'A' },
        { asin: 'B002', title: 'B' },
      ]),
    ];

    applyDeltaAnnotations(results, []);

    const items = (results[0] as StructuredResult).data.items!;
    expect(items[0].__delta).toBe('NEW');
    expect(items[1].__delta).toBe('NEW');
  });

  it('annotates items in single-item (product) pages', () => {
    const results: ExtractionResult[] = [{
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'product',
      schemaVersion: '1',
      url: 'https://amazon.com/dp/B00',
      title: 'Product',
      data: { item: { asin: 'B00', title: 'Widget', price: '$8' } },
    }];
    const prev = [{ asin: 'B00', title: 'Widget', price: '$10' }];

    applyDeltaAnnotations(results, prev);

    const item = (results[0] as StructuredResult).data.item!;
    expect(item.__delta).toBe('CHG');
  });

  it('ignores items without a matchable key', () => {
    const results: ExtractionResult[] = [
      makeStructured('test.com', 'search', [
        { price: '$10' }, // no ID, no title
      ]),
    ];

    applyDeltaAnnotations(results, []);

    const items = (results[0] as StructuredResult).data.items!;
    expect(items[0].__delta).toBeUndefined();
  });
});
