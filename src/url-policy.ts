export function isHttpOrHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateCaptureUrls(value: unknown): { urls?: string[]; error?: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'urls must be a non-empty array' };
  }

  const invalid = value.filter((url) => !isHttpOrHttpsUrl(url));
  if (invalid.length > 0) {
    const sample = String(invalid[0]).slice(0, 120);
    return {
      error: `Only http:// and https:// URLs can be opened for background capture. Rejected: ${sample}`,
    };
  }

  return { urls: value as string[] };
}
