import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { getDefaultSaveDir } from './paths.js';

describe('getDefaultSaveDir', () => {
  it('uses Documents/saved-pages under the current home directory by default', () => {
    expect(getDefaultSaveDir('/Users/ryan', {})).toBe(join('/Users/ryan', 'Documents', 'saved-pages'));
  });

  it('allows PAGE_SAVE_DIR to override the default location', () => {
    expect(getDefaultSaveDir('/Users/ryan', { PAGE_SAVE_DIR: 'custom-pages' })).toBe(resolve('custom-pages'));
  });
});
