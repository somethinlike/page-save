import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DEFAULT_SAVE_DIR_NAME = 'saved-pages';

export function getDefaultSaveDir(
  homeDir: string = homedir(),
  env: { PAGE_SAVE_DIR?: string } = process.env,
): string {
  return env.PAGE_SAVE_DIR
    ? resolve(env.PAGE_SAVE_DIR)
    : join(homeDir, 'Documents', DEFAULT_SAVE_DIR_NAME);
}

export const SAVE_DIR = getDefaultSaveDir();
