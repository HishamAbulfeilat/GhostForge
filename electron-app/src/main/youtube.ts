import { exec } from 'child_process';
import { homedir } from 'os';

const PYTHON_BRIDGE_BASE = 'http://localhost:8765';

/** Metadata returned for a YouTube video */
export interface YouTubeVideoInfo {
  url: string;
  title: string;
  author: string;
  duration: string;
  viewCount: number;
  thumbnail: string;
  description: string;
  publishedAt: string;
}

/** A single segment of a transcript */
export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

/** A trending video entry */
export interface TrendingVideo {
  url: string;
  title: string;
  author: string;
  viewCount: number;
  thumbnail: string;
  duration: string;
}

/** Summary result for a video */
export interface VideoSummary {
  url: string;
  title: string;
  transcriptLength: number;
  summary: string;
  keyPoints: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Search YouTube and open results in the default browser.
 * Falls back to a browser search when the bridge is unavailable.
 */
export async function searchAndPlay(query: string): Promise<string> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  await openInBrowser(searchUrl);
  return `Opened YouTube search for "${query}"`;
}

/**
 * Fetch the transcript for a YouTube video.
 * Tries the Python bridge first; falls back to browser-based extraction.
 */
export async function getTranscript(videoUrl: string): Promise<TranscriptSegment[]> {
  const videoId = extractVideoId(videoUrl);

  // Try Python bridge (youtube-transcript-api)
  try {
    const response = await fetchFromBridge('/transcript', { video_id: videoId });
    if (response.ok) {
      const data: any = await response.json();
      return (data.transcript || []) as TranscriptSegment[];
    }
  } catch {}

  // Fallback: open video in browser for manual transcript access
  await openInBrowser(videoUrl);
  return [];
}

/**
 * Fetch video metadata (title, author, duration, etc.).
 * Tries the Python bridge first; falls back to oembed API.
 */
export async function getVideoInfo(videoUrl: string): Promise<YouTubeVideoInfo> {
  const videoId = extractVideoId(videoUrl);

  // Try Python bridge
  try {
    const response = await fetchFromBridge('/video_info', { video_id: videoId });
    if (response.ok) {
      const data: any = await response.json();
      return {
        url: videoUrl,
        title: data.title || 'Unknown',
        author: data.author || 'Unknown',
        duration: data.duration || '0:00',
        viewCount: data.view_count || 0,
        thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        description: data.description || '',
        publishedAt: data.published_at || '',
      };
    }
  } catch {}

  // Fallback: oembed (limited metadata)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data: any = await response.json();
      return {
        url: videoUrl,
        title: data.title || 'Unknown',
        author: data.author_name || 'Unknown',
        duration: 'Unknown',
        viewCount: 0,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        description: '',
        publishedAt: '',
      };
    }
  } catch {}

  return {
    url: videoUrl,
    title: 'Unknown',
    author: 'Unknown',
    duration: 'Unknown',
    viewCount: 0,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    description: '',
    publishedAt: '',
  };
}

/**
 * Fetch trending videos for a given region.
 * Tries the Python bridge first; falls back to an empty list.
 */
export async function getTrending(region: string = 'US'): Promise<TrendingVideo[]> {
  try {
    const response = await fetchFromBridge('/trending', { region });
    if (response.ok) {
      const data: any = await response.json();
      return (data.videos || []) as TrendingVideo[];
    }
  } catch {}

  return [];
}

/**
 * Generate a summary for a YouTube video by fetching its transcript
 * and passing it through a summarization prompt.
 */
export async function summarizeVideo(videoUrl: string): Promise<VideoSummary> {
  const videoId = extractVideoId(videoUrl);
  const info = await getVideoInfo(videoUrl);
  const transcript = await getTranscript(videoUrl);

  if (transcript.length === 0) {
    return {
      url: videoUrl,
      title: info.title,
      transcriptLength: 0,
      summary: 'Transcript not available — video may not have captions.',
      keyPoints: [],
    };
  }

  // Combine transcript text
  const fullText = transcript.map(s => s.text).join(' ');

  // Generate summary via bridge
  try {
    const response = await fetchFromBridge('/summarize', {
      text: fullText,
      title: info.title,
    });

    if (response.ok) {
      const data: any = await response.json();
      return {
        url: videoUrl,
        title: info.title,
        transcriptLength: transcript.length,
        summary: data.summary || fullText.slice(0, 500),
        keyPoints: data.key_points || [],
      };
    }
  } catch {}

  // Fallback: truncated transcript as summary
  return {
    url: videoUrl,
    title: info.title,
    transcriptLength: transcript.length,
    summary: fullText.length > 500 ? fullText.slice(0, 500) + '…' : fullText,
    keyPoints: [],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Last resort: assume the entire string is an ID
  return url.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 11);
}

async function fetchFromBridge(path: string, body: unknown): Promise<Response> {
  return fetch(`${PYTHON_BRIDGE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;

  return new Promise((resolve, reject) => {
    let cmd: string;

    if (platform === 'darwin') {
      cmd = `open "${url}"`;
    } else if (platform === 'win32') {
      cmd = `start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    exec(cmd, (error) => {
      if (error) reject(new Error(`Failed to open URL: ${error.message}`));
      else resolve();
    });
  });
}
