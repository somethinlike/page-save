import { describe, expect, it } from 'vitest';
import { isHttpOrHttpsUrl, validateCaptureUrls } from './url-policy.js';

describe('isHttpOrHttpsUrl', () => {
  it('allows normal web URLs', () => {
    expect(isHttpOrHttpsUrl('https://example.com/page')).toBe(true);
    expect(isHttpOrHttpsUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects browser, file, script, and malformed URLs', () => {
    expect(isHttpOrHttpsUrl('chrome://extensions')).toBe(false);
    expect(isHttpOrHttpsUrl('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/page.html')).toBe(false);
    expect(isHttpOrHttpsUrl('file:///C:/Users/Ryan/secret.txt')).toBe(false);
    expect(isHttpOrHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpOrHttpsUrl('not a url')).toBe(false);
  });

  it('rejects leading or trailing whitespace', () => {
    expect(isHttpOrHttpsUrl(' https://example.com')).toBe(false);
    expect(isHttpOrHttpsUrl('https://example.com ')).toBe(false);
  });
});

describe('validateCaptureUrls', () => {
  it('returns normalized string arrays when all URLs are web URLs', () => {
    expect(validateCaptureUrls(['https://example.com', 'http://example.test']).urls).toEqual([
      'https://example.com',
      'http://example.test',
    ]);
  });

  it('rejects empty or non-array input', () => {
    expect(validateCaptureUrls([]).error).toContain('non-empty array');
    expect(validateCaptureUrls('https://example.com').error).toContain('non-empty array');
  });

  it('rejects any non-web URL in the batch', () => {
    const result = validateCaptureUrls(['https://example.com', 'file:///C:/Users/Ryan/secret.txt']);
    expect(result.error).toContain('Only http:// and https:// URLs');
    expect(result.urls).toBeUndefined();
  });
});
