import { describe, it, expect } from 'vitest';
import {
  generateSchema,
  formatSchemaSummary,
  deriveUrlPattern,
  guessPageType,
  scoreCandidate,
} from './schema-suggest.ts';
import type { DomProbeResult, DomProbeCandidate } from './types.ts';

describe('deriveUrlPattern', () => {
  it('extracts path + first query param when query string is present', () => {
    expect(deriveUrlPattern('https://amazon.com/s?k=creatine&ref=nb_sb_noss')).toBe('/s?k=creatine');
  });

  it('returns first two path segments when no query string', () => {
    expect(deriveUrlPattern('https://amazon.com/dp/B00E9M4XFI')).toBe('/dp/B00E9M4XFI');
  });

  it('returns path as-is when there is only one segment', () => {
    expect(deriveUrlPattern('https://example.com/search')).toBe('/search');
  });

  it('returns root for empty path', () => {
    expect(deriveUrlPattern('https://example.com/')).toBe('/');
  });

  it('returns / for malformed URLs', () => {
    expect(deriveUrlPattern('not-a-valid-url')).toBe('/');
  });
});

describe('guessPageType', () => {
  it('identifies search pages by URL patterns', () => {
    expect(guessPageType('https://amazon.com/s?k=creatine')).toBe('search');
    expect(guessPageType('https://walmart.com/search?q=widget')).toBe('search');
    expect(guessPageType('https://chewy.com/s?query=food')).toBe('search');
    expect(guessPageType('https://iherb.com/search?kw=vitamin')).toBe('search');
  });

  it('identifies product pages', () => {
    expect(guessPageType('https://amazon.com/dp/B00E9M4XFI')).toBe('product');
    expect(guessPageType('https://walmart.com/ip/widget/12345')).toBe('search'); // not in product patterns
    expect(guessPageType('https://example.com/product/widget')).toBe('product');
    expect(guessPageType('https://example.com/item/12345')).toBe('product');
  });

  it('identifies category/browse pages', () => {
    expect(guessPageType('https://example.com/category/electronics')).toBe('category');
    expect(guessPageType('https://example.com/browse/tools')).toBe('category');
    expect(guessPageType('https://example.com/c/widgets')).toBe('category');
  });

  it('defaults to search for ambiguous URLs', () => {
    expect(guessPageType('https://example.com/')).toBe('search');
  });
});

describe('scoreCandidate', () => {
  it('scores higher for candidates with more fields', () => {
    const fewFields: DomProbeCandidate = {
      selector: '.card',
      count: 10,
      sampleFields: [{ name: 'title', selector: 'h2', type: 'text', sample: 'Test' }],
    };

    const manyFields: DomProbeCandidate = {
      selector: '.card',
      count: 10,
      sampleFields: [
        { name: 'title', selector: 'h2', type: 'text', sample: 'Test' },
        { name: 'price', selector: '.price', type: 'text', sample: '$10' },
        { name: 'rating', selector: '.rating', type: 'text', sample: '4.5' },
      ],
    };

    expect(scoreCandidate(manyFields)).toBeGreaterThan(scoreCandidate(fewFields));
  });

  it('boosts score for named fields (not generic "text")', () => {
    const generic: DomProbeCandidate = {
      selector: '.card',
      count: 10,
      sampleFields: [
        { name: 'text', selector: 'span', type: 'text', sample: 'Some text' },
      ],
    };

    const named: DomProbeCandidate = {
      selector: '.card',
      count: 10,
      sampleFields: [
        { name: 'price', selector: '.price', type: 'text', sample: '$10' },
      ],
    };

    expect(scoreCandidate(named)).toBeGreaterThan(scoreCandidate(generic));
  });

  it('boosts moderate item counts (5-50) over very small counts', () => {
    const tooFew: DomProbeCandidate = {
      selector: '.card',
      count: 3,
      sampleFields: [{ name: 'title', selector: 'h2', type: 'text', sample: 'T' }],
    };

    const ideal: DomProbeCandidate = {
      selector: '.card',
      count: 20,
      sampleFields: [{ name: 'title', selector: 'h2', type: 'text', sample: 'T' }],
    };

    expect(scoreCandidate(ideal)).toBeGreaterThan(scoreCandidate(tooFew));
  });

  it('penalizes extremely high counts (likely layout noise)', () => {
    const moderate: DomProbeCandidate = {
      selector: '.card',
      count: 20,
      sampleFields: [{ name: 'title', selector: 'h2', type: 'text', sample: 'T' }],
    };

    const noise: DomProbeCandidate = {
      selector: 'div',
      count: 500,
      sampleFields: [{ name: 'title', selector: 'h2', type: 'text', sample: 'T' }],
    };

    expect(scoreCandidate(moderate)).toBeGreaterThan(scoreCandidate(noise));
  });
});

describe('generateSchema', () => {
  const baseProbe: DomProbeResult = {
    url: 'https://shop.example.com/s?q=widget',
    domain: 'shop.example.com',
    candidates: [
      {
        selector: '.product-card',
        count: 24,
        sampleFields: [
          { name: 'title', selector: 'h3', type: 'text', sample: 'Widget Pro' },
          { name: 'price', selector: '.price', type: 'text', sample: '$29.99' },
          { name: 'rating', selector: '.rating', type: 'text', sample: '4.5' },
        ],
      },
    ],
  };

  it('generates a valid draft schema from probe results', () => {
    const schema = generateSchema(baseProbe);

    expect(schema.domain).toBe('shop.example.com');
    expect(schema.status).toBe('draft');
    expect(schema.version).toBe('1');
    expect(schema.pages.search).toBeDefined();
    expect(schema.pages.search.container).toBe('.product-card');
    expect(schema.pages.search.fields.title).toEqual({ selector: 'h3', type: 'text' });
    expect(schema.pages.search.fields.price).toEqual({ selector: '.price', type: 'text' });
  });

  it('strips www. prefix from domain', () => {
    const probe: DomProbeResult = {
      ...baseProbe,
      domain: 'www.shop.example.com',
    };

    const schema = generateSchema(probe);
    expect(schema.domain).toBe('shop.example.com');
  });

  it('picks best-scoring candidate when multiple are present', () => {
    const probe: DomProbeResult = {
      url: 'https://shop.example.com/s?q=widget',
      domain: 'shop.example.com',
      candidates: [
        {
          selector: '.sidebar-item',
          count: 3,
          sampleFields: [
            { name: 'text', selector: 'span', type: 'text', sample: 'Menu item' },
          ],
        },
        {
          selector: '.product-card',
          count: 20,
          sampleFields: [
            { name: 'title', selector: 'h3', type: 'text', sample: 'Widget' },
            { name: 'price', selector: '.price', type: 'text', sample: '$10' },
            { name: 'rating', selector: '.stars', type: 'text', sample: '4.5' },
          ],
        },
      ],
    };

    const schema = generateSchema(probe);
    expect(schema.pages.search.container).toBe('.product-card');
  });

  it('produces a fallback schema when no candidates exist', () => {
    const probe: DomProbeResult = {
      url: 'https://shop.example.com/s?q=widget',
      domain: 'shop.example.com',
      candidates: [],
    };

    const schema = generateSchema(probe);
    expect(schema.pages.search.container).toBe('MANUAL_SELECTOR_NEEDED');
    expect(schema.pages.search.fields).toEqual({});
  });

  it('uses product page type for /dp/ URLs', () => {
    const probe: DomProbeResult = {
      ...baseProbe,
      url: 'https://shop.example.com/dp/B00E9M4XFI',
    };

    const schema = generateSchema(probe);
    expect(schema.pages.product).toBeDefined();
    expect(schema.pages.search).toBeUndefined();
  });

  it('deduplicates field names by appending suffixes', () => {
    const probe: DomProbeResult = {
      url: 'https://shop.example.com/s?q=widget',
      domain: 'shop.example.com',
      candidates: [
        {
          selector: '.card',
          count: 10,
          sampleFields: [
            { name: 'price', selector: '.primary-price', type: 'text', sample: '$10' },
            { name: 'price', selector: '.secondary-price', type: 'text', sample: '$12' },
          ],
        },
      ],
    };

    const schema = generateSchema(probe);
    const fieldNames = Object.keys(schema.pages.search.fields);
    expect(fieldNames).toContain('price');
    expect(fieldNames).toContain('price2');
  });
});

describe('formatSchemaSummary', () => {
  it('formats a schema as a human-readable summary', () => {
    const schema = {
      domain: 'example.com',
      version: '1',
      status: 'draft',
      description: 'Test',
      pages: {
        search: {
          urlPattern: '/s?q=',
          description: 'Search',
          container: '.card',
          fields: {
            title: { selector: 'h2', type: 'text' },
            price: { selector: '.price', type: 'text' },
          },
        },
      },
    };

    const summary = formatSchemaSummary(schema);

    expect(summary).toContain('Schema: example.com (draft)');
    expect(summary).toContain('Container: .card');
    expect(summary).toContain('title: h2 (text)');
    expect(summary).toContain('price: .price (text)');
  });
});
