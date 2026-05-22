#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpPath = join(__dirname, '..', 'dist', 'mcp-server.js');

try {
  execFileSync(process.execPath, [mcpPath], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (err) {
  process.exit(err.status || 1);
}
