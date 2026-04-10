/**
 * youtube-extractor.ts — Extract subtitles/captions from YouTube videos
 *
 * Fetches captions via YouTube's timedtext API. Falls back to
 * auto-generated captions if manual ones aren't available.
 * Outputs clean timestamped transcript text.
 */

export interface YoutubeResult {
  type: 'youtube';
  videoId: string;
  title: string;
  channel: string;
  url: string;
  duration: string;
  language: string;
  transcript: string;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' for auto-generated
  name?: { simpleText?: string };
}

/**
 * Extract video ID from a YouTube URL.
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    }
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
  } catch {}
  return null;
}

/**
 * Parse YouTube's timedtext XML into timestamped plain text.
 */
function parseTimedText(xml: string): string {
  const lines: string[] = [];
  // Match <text start="X" dur="Y">content</text>
  const regex = /<text\s+start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const startSec = parseFloat(match[1]);
    const text = match[2]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, '') // strip any nested tags
      .trim();

    if (!text) continue;

    const mins = Math.floor(startSec / 60);
    const secs = Math.floor(startSec % 60);
    const timestamp = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    lines.push(`[${timestamp}] ${text}`);
  }

  return lines.join('\n');
}

/**
 * Fetch caption tracks from a YouTube page's HTML.
 * YouTube embeds caption data in the page's initial data JSON.
 */
function extractCaptionTracks(pageHtml: string): CaptionTrack[] {
  // Look for the captions data in ytInitialPlayerResponse
  const match = pageHtml.match(/"captions":\s*(\{.*?"captionTracks":\s*\[.*?\].*?\})/s);
  if (!match) return [];

  try {
    // Extract just the captionTracks array
    const tracksMatch = match[1].match(/"captionTracks":\s*(\[.*?\])/s);
    if (!tracksMatch) return [];
    return JSON.parse(tracksMatch[1]) as CaptionTrack[];
  } catch {
    return [];
  }
}

/**
 * Extract video metadata from YouTube page HTML.
 */
function extractVideoMeta(pageHtml: string): { title: string; channel: string; duration: string } {
  let title = '';
  let channel = '';
  let duration = '';

  // Title from og:title meta tag
  const titleMatch = pageHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  if (titleMatch) title = titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

  // Channel from link itemprop="name"
  const channelMatch = pageHtml.match(/"ownerChannelName":"([^"]+)"/);
  if (channelMatch) channel = channelMatch[1];

  // Duration from meta tag
  const durationMatch = pageHtml.match(/"lengthSeconds":"(\d+)"/);
  if (durationMatch) {
    const totalSec = parseInt(durationMatch[1], 10);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    duration = hrs > 0
      ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
  }

  return { title, channel, duration };
}

/**
 * Fetch and extract subtitles from a YouTube video.
 * Requires the full page HTML from the extension (contains caption track URLs).
 */
export async function extractSubtitles(pageHtml: string, url: string): Promise<YoutubeResult> {
  const videoId = extractVideoId(url) || '';
  const meta = extractVideoMeta(pageHtml);
  const tracks = extractCaptionTracks(pageHtml);

  if (tracks.length === 0) {
    return {
      type: 'youtube',
      videoId,
      title: meta.title,
      channel: meta.channel,
      url,
      duration: meta.duration,
      language: '',
      transcript: '(No captions available for this video)',
    };
  }

  // Prefer manual English, then manual any, then auto-generated English, then first available
  const manualEn = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
  const manualAny = tracks.find(t => t.kind !== 'asr');
  const autoEn = tracks.find(t => t.languageCode === 'en' && t.kind === 'asr');
  const best = manualEn || manualAny || autoEn || tracks[0];

  const language = best.languageCode + (best.kind === 'asr' ? ' (auto-generated)' : '');

  // Fetch the caption XML
  try {
    const response = await fetch(best.baseUrl);
    if (!response.ok) {
      return {
        type: 'youtube',
        videoId,
        title: meta.title,
        channel: meta.channel,
        url,
        duration: meta.duration,
        language,
        transcript: `(Failed to fetch captions: HTTP ${response.status})`,
      };
    }

    const xml = await response.text();
    const transcript = parseTimedText(xml);

    return {
      type: 'youtube',
      videoId,
      title: meta.title,
      channel: meta.channel,
      url,
      duration: meta.duration,
      language,
      transcript: transcript || '(Captions track was empty)',
    };
  } catch (err) {
    return {
      type: 'youtube',
      videoId,
      title: meta.title,
      channel: meta.channel,
      url,
      duration: meta.duration,
      language,
      transcript: `(Error fetching captions: ${(err as Error).message})`,
    };
  }
}

/**
 * Format a YouTube result as markdown.
 */
export function formatYoutubeMarkdown(result: YoutubeResult): string {
  const lines = [
    `# Video: ${result.title}`,
    `- Channel: ${result.channel}`,
    `- Duration: ${result.duration}`,
    `- Language: ${result.language}`,
    `- URL: ${result.url}`,
    '',
    result.transcript,
    '',
  ];
  return lines.join('\n');
}
