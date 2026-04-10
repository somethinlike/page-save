/**
 * defuddle-extractor.ts — Clean article extraction using Defuddle
 *
 * Replaces raw innerText fallback with Defuddle-powered extraction.
 * Strips nav bars, ads, sidebars, footers — outputs clean article content
 * as markdown. Uses defuddle/node which handles DOM parsing internally.
 */

import { Defuddle } from 'defuddle/node';

export interface DefuddleResult {
  content: string;
  title: string;
  description: string;
  author: string;
  wordCount: number;
}

/**
 * Extract clean article content from raw HTML using Defuddle.
 * Returns markdown-formatted content with metadata.
 */
export async function extractWithDefuddle(html: string, url: string): Promise<DefuddleResult> {
  const result = await Defuddle(html, url, { markdown: true });

  return {
    content: result.content || '',
    title: result.title || '',
    description: result.description || '',
    author: result.author || '',
    wordCount: result.wordCount || 0,
  };
}
