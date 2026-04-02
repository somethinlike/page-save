import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAVE_DIR } from './types.ts';

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
}

export function buildFilePath(title: string, saveDir: string = SAVE_DIR): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeName = sanitizeFilename(title) || 'page';
  const filename = `${safeName}-${timestamp}.mhtml`;

  mkdirSync(saveDir, { recursive: true });
  return join(saveDir, filename);
}

export function writeMhtml(base64Data: string, title: string, saveDir: string = SAVE_DIR): string {
  const filePath = buildFilePath(title, saveDir);
  const buffer = Buffer.from(base64Data, 'base64');
  writeFileSync(filePath, buffer);
  return filePath;
}
