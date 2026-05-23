import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const sourceSchemasDir = join(projectRoot, 'schemas');
const extensionSchemasDir = join(projectRoot, 'extension', 'schemas');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('schema file sync', () => {
  it('keeps extension schema manifest in sync with source schemas', () => {
    const sourceFiles = readdirSync(sourceSchemasDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
      .sort();
    const manifest = readJson(join(extensionSchemasDir, 'manifest.json')) as { schemas: string[] };

    expect([...manifest.schemas].sort()).toEqual(sourceFiles);
  });

  it('keeps extension schema copies identical to source schemas', () => {
    const sourceFiles = readdirSync(sourceSchemasDir)
      .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
      .sort();

    for (const file of sourceFiles) {
      const sourcePath = join(sourceSchemasDir, file);
      const extensionPath = join(extensionSchemasDir, file);

      expect(existsSync(extensionPath), `${file} missing from extension/schemas`).toBe(true);
      expect(readJson(extensionPath)).toEqual(readJson(sourcePath));
    }
  });
});
