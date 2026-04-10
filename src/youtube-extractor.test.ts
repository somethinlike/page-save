import { describe, it, expect } from 'vitest';
import {
  extractVideoId,
  parseTimedText,
  extractCaptionTracks,
  extractVideoMeta,
  formatYoutubeMarkdown,
} from './youtube-extractor.ts';
import type { YoutubeResult } from './youtube-extractor.ts';

describe('extractVideoId', () => {
  it('extracts ID from standard watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from watch URL with additional params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=abc123XYZ&t=120s&feature=share')).toBe('abc123XYZ');
  });

  it('extracts ID from youtu.be short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(extractVideoId('https://www.example.com/video')).toBe(null);
  });

  it('returns null for YouTube URL without v param', () => {
    expect(extractVideoId('https://www.youtube.com/watch')).toBe(null);
  });

  it('returns null for malformed URLs', () => {
    expect(extractVideoId('not-a-url')).toBe(null);
  });
});

describe('parseTimedText', () => {
  it('parses a single caption line', () => {
    const xml = '<?xml version="1.0"?><transcript><text start="0" dur="3">Hello world</text></transcript>';
    const result = parseTimedText(xml);
    expect(result).toContain('[00:00] Hello world');
  });

  it('parses multiple caption lines with timestamps', () => {
    const xml = `<?xml version="1.0"?><transcript>
      <text start="0" dur="3">Intro sentence</text>
      <text start="65" dur="4">Minute mark content</text>
      <text start="3725" dur="5">Past an hour mark</text>
    </transcript>`;
    const result = parseTimedText(xml);
    expect(result).toContain('[00:00] Intro sentence');
    expect(result).toContain('[01:05] Minute mark content');
    expect(result).toContain('[62:05] Past an hour mark');
  });

  it('decodes HTML entities in caption text', () => {
    const xml = '<text start="0" dur="3">Tom &amp; Jerry said &quot;hi&quot;</text>';
    const result = parseTimedText(xml);
    expect(result).toContain('Tom & Jerry said "hi"');
  });

  it('strips nested HTML tags from caption text', () => {
    const xml = '<text start="0" dur="3">Hello <b>bold</b> world</text>';
    const result = parseTimedText(xml);
    expect(result).toContain('Hello bold world');
  });

  it('skips empty caption entries', () => {
    const xml = `<transcript>
      <text start="0" dur="3">Real content</text>
      <text start="5" dur="1"></text>
      <text start="10" dur="2">More content</text>
    </transcript>`;
    const result = parseTimedText(xml);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('handles fractional seconds by flooring', () => {
    const xml = '<text start="59.5" dur="3">Just under a minute</text>';
    const result = parseTimedText(xml);
    expect(result).toContain('[00:59]');
  });

  it('returns empty string for XML with no text elements', () => {
    const xml = '<?xml version="1.0"?><transcript></transcript>';
    expect(parseTimedText(xml)).toBe('');
  });
});

describe('extractCaptionTracks', () => {
  it('extracts caption tracks from embedded JSON', () => {
    const html = `
      <html><body>
      <script>
      var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://youtube.com/timedtext?v=abc","languageCode":"en","kind":"asr"}]}}};
      </script>
      </body></html>
    `;
    const tracks = extractCaptionTracks(html);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].languageCode).toBe('en');
    expect(tracks[0].kind).toBe('asr');
  });

  it('returns empty array when no captions data is found', () => {
    const html = '<html><body>No video here</body></html>';
    const tracks = extractCaptionTracks(html);
    expect(tracks).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    const html = '"captions":{"captionTracks":[broken json]}';
    expect(extractCaptionTracks(html)).toEqual([]);
  });
});

describe('extractVideoMeta', () => {
  it('extracts title from og:title meta tag', () => {
    const html = '<meta property="og:title" content="How Transformers Work">';
    const meta = extractVideoMeta(html);
    expect(meta.title).toBe('How Transformers Work');
  });

  it('decodes HTML entities in title', () => {
    const html = '<meta property="og:title" content="Tom &amp; Jerry&#39;s Adventure">';
    const meta = extractVideoMeta(html);
    expect(meta.title).toBe("Tom & Jerry's Adventure");
  });

  it('extracts channel from ownerChannelName field', () => {
    const html = '{"ownerChannelName":"3Blue1Brown"}';
    const meta = extractVideoMeta(html);
    expect(meta.channel).toBe('3Blue1Brown');
  });

  it('formats duration for videos under an hour', () => {
    const html = '"lengthSeconds":"1574"'; // 26 min 14 sec
    const meta = extractVideoMeta(html);
    expect(meta.duration).toBe('26:14');
  });

  it('formats duration for videos over an hour', () => {
    const html = '"lengthSeconds":"3725"'; // 1:02:05
    const meta = extractVideoMeta(html);
    expect(meta.duration).toBe('1:02:05');
  });

  it('returns empty strings when fields are missing', () => {
    const meta = extractVideoMeta('<html></html>');
    expect(meta.title).toBe('');
    expect(meta.channel).toBe('');
    expect(meta.duration).toBe('');
  });
});

describe('formatYoutubeMarkdown', () => {
  it('formats a complete YouTube result with metadata and transcript', () => {
    const result: YoutubeResult = {
      type: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      title: 'Sample Video',
      channel: 'Sample Channel',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      duration: '3:45',
      language: 'en',
      transcript: '[00:00] Hello\n[00:05] World',
    };

    const md = formatYoutubeMarkdown(result);

    expect(md).toContain('# Video: Sample Video');
    expect(md).toContain('- Channel: Sample Channel');
    expect(md).toContain('- Duration: 3:45');
    expect(md).toContain('- Language: en');
    expect(md).toContain('[00:00] Hello');
    expect(md).toContain('[00:05] World');
  });
});
