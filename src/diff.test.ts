import { describe, it, expect } from 'vitest';
import { diffItems, diffSingleItem, formatDiffSummary } from './diff.ts';

describe('diffItems', () => {
  it('detects added items (present in curr, absent in prev)', () => {
    const prev = [{ asin: 'A1', price: '$10' }];
    const curr = [
      { asin: 'A1', price: '$10' },
      { asin: 'A2', price: '$20' },
    ];

    const diff = diffItems(prev, curr);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].asin).toBe('A2');
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('detects removed items (present in prev, absent in curr)', () => {
    const prev = [
      { asin: 'A1', price: '$10' },
      { asin: 'A2', price: '$20' },
    ];
    const curr = [{ asin: 'A1', price: '$10' }];

    const diff = diffItems(prev, curr);

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].asin).toBe('A2');
    expect(diff.added).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('detects changed items (same key, different field values)', () => {
    const prev = [{ asin: 'A1', price: '$10', title: 'Widget' }];
    const curr = [{ asin: 'A1', price: '$8', title: 'Widget' }];

    const diff = diffItems(prev, curr);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].item.asin).toBe('A1');
    expect(diff.changed[0].changes).toHaveLength(1);
    expect(diff.changed[0].changes[0].field).toBe('price');
    expect(diff.changed[0].changes[0].prev).toBe('$10');
    expect(diff.changed[0].changes[0].curr).toBe('$8');
    expect(diff.unchanged).toBe(0);
  });

  it('counts unchanged items when nothing differs', () => {
    const prev = [
      { asin: 'A1', price: '$10' },
      { asin: 'A2', price: '$20' },
    ];
    const curr = [
      { asin: 'A1', price: '$10' },
      { asin: 'A2', price: '$20' },
    ];

    const diff = diffItems(prev, curr);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(2);
  });

  it('uses listingId as unique key when asin is absent', () => {
    const prev = [{ listingId: 'L1', price: '$10' }];
    const curr = [{ listingId: 'L1', price: '$12' }];

    const diff = diffItems(prev, curr);

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].changes[0].field).toBe('price');
  });

  it('falls back to title when no ID field exists', () => {
    const prev = [{ title: 'Product A', price: '$10' }];
    const curr = [{ title: 'Product A', price: '$15' }];

    const diff = diffItems(prev, curr);

    expect(diff.changed).toHaveLength(1);
  });

  it('respects watchFields filter — only tracks specified fields', () => {
    const prev = [{ asin: 'A1', price: '$10', title: 'Old Title', rating: '4.0' }];
    const curr = [{ asin: 'A1', price: '$10', title: 'New Title', rating: '4.5' }];

    // Only watch price — title change should be ignored
    const diff = diffItems(prev, curr, ['price']);

    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('handles empty arrays', () => {
    const diff = diffItems([], []);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(0);
  });

  it('handles all-new on first snapshot (empty prev)', () => {
    const diff = diffItems([], [{ asin: 'A1' }, { asin: 'A2' }]);
    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(0);
  });
});

describe('diffSingleItem', () => {
  it('returns empty array when items are identical', () => {
    const prev = { price: '$10', rating: '4.5' };
    const curr = { price: '$10', rating: '4.5' };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(0);
  });

  it('detects single field change', () => {
    const prev = { price: '$10', rating: '4.5' };
    const curr = { price: '$8', rating: '4.5' };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('price');
    expect(changes[0].prev).toBe('$10');
    expect(changes[0].curr).toBe('$8');
  });

  it('detects multiple field changes', () => {
    const prev = { price: '$10', rating: '4.5', stock: 'in' };
    const curr = { price: '$8', rating: '4.5', stock: 'out' };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(2);
    const fieldNames = changes.map(c => c.field).sort();
    expect(fieldNames).toEqual(['price', 'stock']);
  });

  it('detects added fields in curr', () => {
    const prev = { price: '$10' };
    const curr = { price: '$10', rating: '4.5' };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('rating');
  });

  it('respects watchFields filter', () => {
    const prev = { price: '$10', rating: '4.5', stock: 'in' };
    const curr = { price: '$8', rating: '3.0', stock: 'out' };

    // Only track price
    const changes = diffSingleItem(prev, curr, ['price']);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('price');
  });

  it('normalizes arrays via JSON stringification for comparison', () => {
    const prev = { features: ['A', 'B'] };
    const curr = { features: ['A', 'B'] };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(0);
  });

  it('detects array changes', () => {
    const prev = { features: ['A', 'B'] };
    const curr = { features: ['A', 'C'] };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('features');
  });

  it('treats null and undefined as equal to empty string for change detection', () => {
    const prev = { price: null, rating: undefined };
    const curr = { price: '', rating: '' };

    const changes = diffSingleItem(prev, curr);

    expect(changes).toHaveLength(0);
  });
});

describe('formatDiffSummary', () => {
  it('formats a diff with all change types', () => {
    const summary = formatDiffSummary({
      added: [{ asin: 'A1', title: 'New Item' }],
      removed: [{ asin: 'A2', title: 'Gone Item' }],
      changed: [{ item: { asin: 'A3', title: 'Changed' }, changes: [{ field: 'price', prev: '$10', curr: '$8' }] }],
      unchanged: 5,
    });

    expect(summary).toContain('NEW: 1 item');
    expect(summary).toContain('+ New Item');
    expect(summary).toContain('REMOVED: 1 item');
    expect(summary).toContain('- Gone Item');
    expect(summary).toContain('CHANGED: 1 item');
    expect(summary).toContain('price: $10 → $8');
    expect(summary).toContain('UNCHANGED: 5 item');
  });

  it('omits sections with zero items', () => {
    const summary = formatDiffSummary({
      added: [],
      removed: [],
      changed: [],
      unchanged: 3,
    });

    expect(summary).not.toContain('NEW:');
    expect(summary).not.toContain('REMOVED:');
    // Use regex to avoid matching UNCHANGED as a substring of CHANGED
    expect(summary).not.toMatch(/(^|[^N])CHANGED:/);
    expect(summary).toContain('UNCHANGED: 3');
  });
});
