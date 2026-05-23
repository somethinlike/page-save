import { describe, expect, it } from 'vitest';
import {
  getExtensionIdFromOrigin,
  isAllowedBrowserOrigin,
  isChromeExtensionOrigin,
  isLoopbackAddress,
} from './ws-handler.js';

const EXTENSION_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('WebSocket boundary helpers', () => {
  it('accepts IPv4, IPv6, and IPv4-mapped loopback peers', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects non-loopback peers', () => {
    expect(isLoopbackAddress('192.168.1.15')).toBe(false);
    expect(isLoopbackAddress('10.0.0.4')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it('extracts Chromium extension IDs from extension origins', () => {
    expect(getExtensionIdFromOrigin(`chrome-extension://${EXTENSION_ID}`)).toBe(EXTENSION_ID);
  });

  it('does not treat websites or malformed extension origins as extension clients', () => {
    expect(getExtensionIdFromOrigin('https://example.com')).toBeNull();
    expect(getExtensionIdFromOrigin('chrome-extension://not-valid')).toBeNull();
    expect(isChromeExtensionOrigin('https://example.com')).toBe(false);
  });

  it('allows no-Origin local CLI clients and real extension origins only', () => {
    expect(isAllowedBrowserOrigin(undefined)).toBe(true);
    expect(isAllowedBrowserOrigin(`chrome-extension://${EXTENSION_ID}`)).toBe(true);
    expect(isAllowedBrowserOrigin('https://example.com')).toBe(false);
  });
});
