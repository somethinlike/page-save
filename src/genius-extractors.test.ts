import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { writeSessionFiles } from './session-writer.js';
import type { StructuredResult } from './types.js';

type Field = { selector: string | string[]; type: string; attribute?: string; scope?: string; exclude?: string };
type Page = { urlPattern?: string; urlPathPattern?: string; container?: string; fields: Record<string, Field>; requiredFields?: string[] };
type Schema = { domain: string; version: string; pages: Record<string, Page>; variants?: Record<string, unknown> };
type Extractors = {
  loadSchemas(): Promise<void>;
  matchSchema(url: string): { schema: Schema; page: Page; pageType: string } | null;
  extractStructured(tabId: number, url: string, options?: { variant?: string }): Promise<Omit<StructuredResult, 'title'>>;
  schemaRegistry: Map<string, Schema>;
};

const source = readFileSync(join(process.cwd(), 'extension', 'extractors.js'), 'utf8');
const geniusSchema = JSON.parse(readFileSync(join(process.cwd(), 'schemas', 'genius.com.json'), 'utf8')) as Schema;
const albumUrl = 'https://genius.com/albums/Fixture-artist/Synthetic-album';
const songUrl = 'https://genius.com/Fixture-artist-shared-title-lyrics';

// These small invented pages exercise observed DOM shapes without retaining
// browsing captures, artist data, or copyrighted lyric fixtures.
const albumHtml = `<!doctype html><html><head>
  <link rel="canonical" href="https://www.genius.com/albums/Fixture-artist/Synthetic-album?tracking=1#tracks">
  </head><body>
  <header class="header_with_cover_art-primary_info">
    <h1 class="header_with_cover_art-primary_info-title">Synthetic Album</h1>
    <a class="header_with_cover_art-primary_info-primary_artist" href="/artists/Fixture-artist?source=album">Fixture Artist</a>
    <span class="metadata_unit">Released October 1, 2026</span>
  </header>
  <div class="chart_row"><span class="chart_row-number_container-number">1</span>
    <div class="chart_row-content"><a href="/Fixture-artist-shared-title-lyrics?from=album#note">
      <h3 class="chart_row-content-title">Shared Title <span class="chart_row-content-title-subtitle">Lyrics</span></h3>
    </a></div></div>
  <div class="chart_row"><span class="chart_row-number_container-number">2</span>
    <div class="chart_row-content"><a href="https://www.genius.com/Fixture-artist-final-signal-lyrics">
      <h3 class="chart_row-content-title">Final Signal</h3>
    </a></div></div>
  <div class="chart_row"><span class="chart_row-number_container-number">3</span>
    <div class="chart_row-content"><a href="/Another-artist-shared-title-lyrics">
      <h3 class="chart_row-content-title">Shared Title <span class="chart_row-content-title-subtitle">Lyrics</span></h3>
    </a></div></div>
  <aside><a href="/Unrelated-recommendation-lyrics">Recommendation</a></aside>
  </body></html>`;

const songHeader = `<head>
  <link rel="canonical" href="https://www.genius.com/Fixture-artist-shared-title-lyrics?source=search#note">
  <meta property="twitter:app:url:iphone" content="genius://songs/123456">
  </head><body>
  <h1 class="SongHeader-desktop__Title-sc-fixture">Shared Title<span data-exclude-from-selection="true">Header tools</span></h1>
  <div class="SongHeader-desktop__SongDetails-sc-fixture">
    <div class="producer"><div class="SongHeader-desktop__CreditList-sc-fixture">
      <a href="/artists/Fixture-producer">Fixture Producer</a>
    </div></div>
    <div class="SongHeader-desktop__CreditList-sc-fixture"><a href="/artists/Fixture-artist?tracking=1">Fixture Artist</a></div>
    <div class="SongHeader-desktop__AlbumCredit-sc-fixture"><span class="HeaderCredit__Label-sc-fixture">Track 7 on</span><span class="HoverMarquee__Container-sc-fixture">Synthetic Album</span></div>
  </div>
  <a class="PrimaryAlbum__Title-sc-fixture" href="/albums/Fixture-artist/Synthetic-album?tracking=1">Synthetic Album (2026)</a>
  <div data-testid="song-info"><div class="Credit__Container-sc-fixture">Produced by Fixture Producer</div></div>`;

const songLyrics = `<div data-lyrics-container="true">[Synthetic verse]<br>Invented line A<br><a href="#annotation">Invented line B</a>
  <span data-exclude-from-selection="true">Embed UI</span><span hidden>Hidden UI</span><span aria-hidden="true">Hidden icon</span><script>unwantedScript()</script><style>.unwanted{}</style><template>Unwanted template</template></div>
  <div data-lyrics-container="true">[Synthetic refrain]<br>Invented line C<br>Invented line D</div>`;

async function harness(html = '<html><body></body></html>') {
  const { document } = parseHTML(html);
  const context = vm.createContext({
    document,
    URL,
    console: { log() {}, error() {} },
    fetch: async () => { throw new Error('Deliberately exercise built-in fallback without network'); },
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      scripting: {
        executeScript: async ({ func, args = [] }: { func: (...args: unknown[]) => unknown; args?: unknown[] }) => {
          context.injectedArgs = args;
          // Serialize as Chrome does: injected code must work without its
          // extension-world closures. DOM queries run through real CSS matching.
          return [{ result: vm.runInContext(`(${func.toString()})(...injectedArgs)`, context) }];
        },
      },
    },
  });
  vm.runInContext(source, context);
  const extractors = context.extractors as Extractors;
  await extractors.loadSchemas();
  return { document, extractors };
}

describe('Genius schema registration and URL boundaries', () => {
  it('keeps the offline built-in fallback identical to the source schema', async () => {
    const { extractors } = await harness();
    expect(extractors.schemaRegistry.get('genius.com')).toEqual(geniusSchema);
  });

  it.each([
    [albumUrl, 'album'],
    [`${albumUrl}/?source=search`, 'album'],
    ['https://www.genius.com/albums/Fixture-artist/Album-lyrics', 'album'],
    [songUrl, 'song'],
    [`${songUrl}/?source=search#note`, 'song'],
    ['https://www.genius.com/Fixture-artist-shared-title-lyrics', 'song'],
  ])('matches the actual Genius path %s as %s', async (url, pageType) => {
    const { extractors } = await harness();
    expect(extractors.matchSchema(url)?.pageType).toBe(pageType);
  });

  it.each([
    'https://genius.com/',
    'https://genius.com/artists/Fixture-artist',
    'https://genius.com/search?q=fixture-lyrics',
    'https://genius.com/search?next=/albums/Fixture-artist/Synthetic-album',
    'https://genius.com/artists/Fixture-lyrics',
    'https://genius.com/Fixture-artist-shared-title-lyrics/annotations',
    'https://genius.com/albums/Fixture-artist',
    'https://genius.com/albums/Fixture-artist/Synthetic-album/tracks',
    'https://genius.com.evil.example/Fixture-artist-shared-title-lyrics',
    'https://notgenius.com/Fixture-artist-shared-title-lyrics',
    'not a URL',
  ])('rejects unsupported or misleading URL %s', async (url) => {
    const { extractors } = await harness();
    expect(extractors.matchSchema(url)).toBeNull();
  });

  it('skips a malformed optional path regex and preserves legacy substring matching', async () => {
    const { extractors } = await harness();
    extractors.schemaRegistry.set('example.com', {
      domain: 'example.com', version: '1', pages: {
        malformed: { urlPathPattern: '[', fields: {} },
        legacy: { urlPattern: '/legacy?', fields: {} },
      },
    });
    expect(extractors.matchSchema('https://example.com/legacy?q=one')?.pageType).toBe('legacy');
    expect(extractors.matchSchema('https://www.amazon.com/dp/B012345678')?.pageType).toBe('product');
  });
});

describe('Genius album extraction', () => {
  it('pairs titles and canonical links in DOM order with album context on every row', async () => {
    const { extractors } = await harness(albumHtml);
    const result = await extractors.extractStructured(1, albumUrl);
    expect(result.pageType).toBe('album');
    expect(result.data.count).toBe(3);
    expect(result.data.items?.map(({ trackNumber, title, itemId }) => ({ trackNumber, title, itemId }))).toEqual([
      { trackNumber: 1, title: 'Shared Title', itemId: songUrl },
      { trackNumber: 2, title: 'Final Signal', itemId: 'https://genius.com/Fixture-artist-final-signal-lyrics' },
      { trackNumber: 3, title: 'Shared Title', itemId: 'https://genius.com/Another-artist-shared-title-lyrics' },
    ]);
    for (const item of result.data.items || []) {
      expect(item).toMatchObject({
        artist: 'Fixture Artist', artistUrl: 'https://genius.com/artists/Fixture-artist',
        album: 'Synthetic Album', albumUrl, releaseDate: 'October 1, 2026',
      });
    }
  });

  it('retains different songs sharing a title when the real session writer deduplicates rows', async () => {
    const { extractors } = await harness(albumHtml);
    const extracted = await extractors.extractStructured(1, albumUrl);
    const result: StructuredResult = { ...extracted, title: 'Synthetic Album' };
    const dir = mkdtempSync(join(tmpdir(), 'page-save-genius-'));
    const session = { dir, reducedDir: join(dir, 'reduced'), rawDir: join(dir, 'raw'), timestamp: 'test-genius' };
    try {
      mkdirSync(session.reducedDir);
      mkdirSync(session.rawDir);
      await writeSessionFiles(session, [result]);
      expect(result.data.count).toBe(3);
      expect(result.data.items).toHaveLength(3);
      expect(new Set(result.data.items?.map(item => item.itemId)).size).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the album tracklist usable in every declared variant', async () => {
    for (const variant of ['playlist', 'metadata', 'lyrics']) {
      const { extractors } = await harness(albumHtml);
      const result = await extractors.extractStructured(1, albumUrl, { variant });
      expect(result.data.error, variant).toBeUndefined();
      expect(result.data.count, variant).toBe(3);
      expect(result.data.items?.[0]).toMatchObject({ title: 'Shared Title', artist: 'Fixture Artist', itemId: songUrl });
      expect(result.data.items?.[0]).not.toHaveProperty('lyrics');
    }
  });

  it('reports an absent container and incomplete rows instead of a successful partial album', async () => {
    const empty = await harness('<html><body><h1>Access check</h1></body></html>');
    expect((await empty.extractors.extractStructured(1, albumUrl)).data.error).toMatch(/No items matched/);
    const incomplete = await harness(albumHtml.replace('<h3 class="chart_row-content-title">Final Signal</h3>', ''));
    const result = await incomplete.extractors.extractStructured(1, albumUrl);
    expect(result.data.error).toMatch(/item 2: title/);
    expect(result.data.items).toBeUndefined();
  });

  it.each([
    'https://foreign.example/Fixture-artist-final-signal-lyrics',
    'javascript:openSong()',
  ])('rejects a required song link after normalization invalidates %s', async (href) => {
    const html = albumHtml.replace('https://www.genius.com/Fixture-artist-final-signal-lyrics', href);
    const { extractors } = await harness(html);
    const result = await extractors.extractStructured(1, albumUrl);
    expect(result.data.error).toMatch(/Required fields missing after normalization in item 2: itemId/);
    expect(result.data.items).toBeUndefined();
  });
});

describe('Genius song extraction', () => {
  it('keeps every lyric block and line break, removes excluded UI, and never mutates the source DOM', async () => {
    const { document, extractors } = await harness(`<html>${songHeader}${songLyrics}</body></html>`);
    const before = document.toString();
    const result = await extractors.extractStructured(1, songUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item).toMatchObject({
      title: 'Shared Title', artist: 'Fixture Artist', artistUrl: 'https://genius.com/artists/Fixture-artist',
      album: 'Synthetic Album', albumUrl, trackNumber: 7, itemId: songUrl, songId: '123456',
      credits: ['Produced by Fixture Producer'],
      lyrics: ['[Synthetic verse]\nInvented line A\nInvented line B', '[Synthetic refrain]\nInvented line C\nInvented line D'],
    });
    expect(document.toString()).toBe(before);
    expect(document.querySelector('[data-exclude-from-selection="true"]')).not.toBeNull();
    expect(document.querySelector('[hidden]')).not.toBeNull();
  });

  it('projects metadata and playlist variants without requiring or querying missing lyrics', async () => {
    for (const variant of ['metadata', 'playlist']) {
      const { extractors } = await harness(`<html>${songHeader}</body></html>`);
      const result = await extractors.extractStructured(1, songUrl, { variant });
      expect(result.data.error, variant).toBeUndefined();
      expect(result.data.item).toMatchObject({ title: 'Shared Title', artist: 'Fixture Artist', album: 'Synthetic Album', itemId: songUrl });
      expect(result.data.item).not.toHaveProperty('lyrics');
      if (variant === 'playlist') expect(result.data.item).not.toHaveProperty('credits');
    }
  });

  it.each(['hidden', 'aria-hidden="true"'])('excludes a selected lyric block whose root has %s', async (attribute) => {
    const hiddenBlock = `<div data-lyrics-container="true" ${attribute}>Excluded block<br>Hidden invented line</div>`;
    const { document, extractors } = await harness(`<html>${songHeader}${hiddenBlock}${songLyrics}</body></html>`);
    const before = document.toString();
    const result = await extractors.extractStructured(1, songUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item?.lyrics).toEqual([
      '[Synthetic verse]\nInvented line A\nInvented line B',
      '[Synthetic refrain]\nInvented line C\nInvented line D',
    ]);
    expect(document.toString()).toBe(before);
  });

  it('preserves real title words and a parenthesized year in the clean album header', async () => {
    const header = songHeader
      .replace('>Shared Title<span', '>No Lyrics<span')
      .replace('>Synthetic Album</span>', '>Memory (2026)</span>');
    const { extractors } = await harness(`<html>${header}${songLyrics}</body></html>`);
    const result = await extractors.extractStructured(1, songUrl);
    expect(result.data.error).toBeUndefined();
    expect(result.data.item).toMatchObject({ title: 'No Lyrics', album: 'Memory (2026)' });
  });

  it.each([
    ['missing', ''],
    ['empty', '<div data-lyrics-container="true"> <span data-exclude-from-selection="true">Only UI</span> </div>'],
  ])('reports %s required lyric content in Full and lyrics variant', async (_label, lyrics) => {
    for (const variant of [undefined, 'lyrics']) {
      const { extractors } = await harness(`<html>${songHeader}${lyrics}</body></html>`);
      const result = await extractors.extractStructured(1, songUrl, { variant });
      expect(result.data.error).toMatch(/Required fields missing: lyrics/);
      expect(result.data.item).toBeUndefined();
    }
  });

  it('reports missing title and artist when a challenge page occupies a valid song URL', async () => {
    const { extractors } = await harness('<html><body><h1>Access check</h1></body></html>');
    const result = await extractors.extractStructured(1, songUrl);
    expect(result.data.error).toMatch(/title, artist, lyrics/);
  });
});

describe('existing extractor behavior', () => {
  it('preserves container attributes, selector fallbacks, arrays, false exists values, and optional fields', async () => {
    const { extractors } = await harness(`<html><body><article data-id="one">
      <h2>Existing title</h2><span class="empty"></span><span class="price">$12</span>
      <ul><li>First feature</li><li>Second feature</li></ul><a href="/detail/one">Open</a>
      </article></body></html>`);
    extractors.schemaRegistry.set('example.com', { domain: 'example.com', version: '1', pages: {
      listing: { urlPattern: '/items', container: 'article', fields: {
        itemId: { selector: '@data-id', type: 'attribute' },
        title: { selector: 'h2', type: 'text' },
        price: { selector: ['.missing', '.empty', '.price'], type: 'text' },
        features: { selector: 'li', type: 'textAll' },
        url: { selector: 'a', type: 'attribute' },
        badge: { selector: '.badge', type: 'exists' },
        optional: { selector: '.absent', type: 'text' },
      } },
    } });
    const result = await extractors.extractStructured(1, 'https://example.com/items');
    expect(result.data).toEqual({ count: 1, items: [{
      itemId: 'one', title: 'Existing title', price: '$12', features: ['First feature', 'Second feature'],
      url: '/detail/one', badge: false, optional: null,
    }] });
  });
});
