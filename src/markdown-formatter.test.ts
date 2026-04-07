import { describe, it, expect } from 'vitest';
import { formatStructuredMarkdown, formatRawMarkdown } from './markdown-formatter.ts';
import type { StructuredResult, RawResult } from './types.ts';

describe('formatStructuredMarkdown', () => {
  it('formats a multi-item result as TSV with headers', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'search',
      schemaVersion: '1',
      url: 'https://www.amazon.com/s?k=protein+powder&ref=nb_sb_noss',
      title: 'Amazon Search: protein powder',
      data: {
        items: [
          { title: 'Whey Protein', price: '$29.99', rating: '4.5' },
          { title: 'Casein Protein', price: '$34.99', rating: '4.2' },
        ],
        count: 2,
      },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('# Amazon Search: protein powder');
    expect(md).toContain('Schema: amazon.com/search v1');
    // URL cleaning strips tracking params
    expect(md).toContain('amazon.com/s?k=protein');
    expect(md).not.toContain('ref=nb_sb_noss');
    // TSV header row
    expect(md).toContain('title\tprice\trating');
    // TSV data rows
    expect(md).toContain('Whey Protein\t$29.99\t4.5');
    expect(md).toContain('Casein Protein\t$34.99\t4.2');
    expect(md).toContain('2 items');
  });

  it('formats a single-item result as key-value pairs', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'product',
      schemaVersion: '1',
      url: 'https://www.amazon.com/dp/B08N5WRWNW',
      title: 'Some Product',
      data: {
        item: { title: 'Widget Pro', price: '$19.99', features: ['Durable', 'Lightweight'] },
      },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('title: Widget Pro');
    expect(md).toContain('price: $19.99');
    expect(md).toContain('features:');
    expect(md).toContain('- Durable');
    expect(md).toContain('- Lightweight');
  });

  it('drops redundant url field when asin is present', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'search',
      schemaVersion: '1',
      url: 'https://www.amazon.com/s?k=test',
      title: 'Test',
      data: {
        items: [
          { asin: 'B08N5WRWNW', url: 'https://www.amazon.com/dp/B08N5WRWNW', title: 'Test Item' },
        ],
        count: 1,
      },
    };

    const md = formatStructuredMarkdown(result);
    const lines = md.split('\n');
    const headerLine = lines.find(l => l.includes('asin'));

    expect(headerLine).toBeDefined();
    expect(headerLine).not.toContain('url');
  });

  it('applies HEADER_MAP to shorten column names', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'test.com',
      pageType: 'listing',
      schemaVersion: '1',
      url: 'https://test.com/search',
      title: 'Test',
      data: {
        items: [
          { reviewCount: '500', ratingText: '4.5', shipping: 'Free' },
        ],
        count: 1,
      },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('reviews\trating\tship');
    expect(md).not.toContain('reviewCount');
  });

  it('formats error result', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'broken.com',
      pageType: 'page',
      schemaVersion: '1',
      url: 'https://broken.com',
      title: 'Broken',
      data: { error: 'Schema mismatch' },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('Error: Schema mismatch');
  });

  it('handles empty data gracefully', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'empty.com',
      pageType: 'page',
      schemaVersion: '1',
      url: 'https://empty.com',
      title: 'Empty',
      data: {},
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('No data extracted.');
  });

  it('formats boolean values as Y/N', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'test.com',
      pageType: 'listing',
      schemaVersion: '1',
      url: 'https://test.com/items',
      title: 'Test',
      data: {
        items: [
          { name: 'Item A', inStock: true, prime: false },
        ],
        count: 1,
      },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('Y');
    expect(md).toContain('N');
  });

  it('cleans Amazon dp URLs to just the ASIN path', () => {
    const result: StructuredResult = {
      type: 'structured',
      domain: 'amazon.com',
      pageType: 'product',
      schemaVersion: '1',
      url: 'https://www.amazon.com/Some-Product-Name/dp/B08N5WRWNW/ref=sr_1_1?dib=abc123&qid=1234',
      title: 'Product Page',
      data: { item: { title: 'Test' } },
    };

    const md = formatStructuredMarkdown(result);

    expect(md).toContain('Source: amazon.com/dp/B08N5WRWNW');
    expect(md).not.toContain('ref=');
    expect(md).not.toContain('dib=');
  });
});

describe('formatRawMarkdown', () => {
  it('formats raw text extraction with title, url, and separator', () => {
    const result: RawResult = {
      type: 'raw',
      domain: 'example.com',
      url: 'https://example.com/article',
      title: 'Example Article',
      text: 'This is the raw page content.',
    };

    const md = formatRawMarkdown(result);

    expect(md).toContain('# Example Article');
    expect(md).toContain('Schema: none (raw text)');
    expect(md).toContain('Source: https://example.com/article');
    expect(md).toContain('---');
    expect(md).toContain('This is the raw page content.');
  });
});
