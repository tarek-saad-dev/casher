import { NextRequest, NextResponse } from 'next/server';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      medium?: { url?: string };
      default?: { url?: string };
    };
    publishedAt?: string;
    description?: string;
  };
}

// YouTube Data API v3 - search endpoint wrapper
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');
    const maxResults = parseInt(searchParams.get('maxResults') || '10', 10);

    if (!q || q.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    // Check if API key is configured
    if (!YOUTUBE_API_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: 'missing_youtube_api_key',
          message: 'YouTube search requires API key. Please set YOUTUBE_API_KEY in environment variables.'
        },
        { status: 503 }
      );
    }

    // Call YouTube Data API
    const apiUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    apiUrl.searchParams.append('part', 'snippet');
    apiUrl.searchParams.append('q', q);
    apiUrl.searchParams.append('type', 'video');
    apiUrl.searchParams.append('maxResults', String(maxResults));
    apiUrl.searchParams.append('videoEmbeddable', 'true');
    apiUrl.searchParams.append('videoSyndicated', 'true');
    apiUrl.searchParams.append('key', YOUTUBE_API_KEY);

    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('[youtube-search] API error:', errorData);
      return NextResponse.json(
        {
          ok: false,
          error: 'youtube_api_error',
          message: errorData?.error?.message || 'YouTube API error'
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Transform results
    const results = data.items?.map((item: YouTubeSearchItem) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title,
      channelTitle: item.snippet?.channelTitle,
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
      publishedAt: item.snippet?.publishedAt,
      description: item.snippet?.description,
    })).filter((item: { videoId?: string }) => item.videoId) || [];

    return NextResponse.json({
      ok: true,
      results,
      query: q,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[youtube-search] Error:', message);
    return NextResponse.json(
      { ok: false, error: 'Internal server error', message },
      { status: 500 }
    );
  }
}
