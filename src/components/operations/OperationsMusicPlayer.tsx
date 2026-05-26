'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Music, Play, Pause, Volume2, Volume1, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';

// Storage keys
const MUSIC_URL_KEY = 'operations-music-url';
const MUSIC_VOLUME_KEY = 'operations-music-volume';

// YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, options: YTPlayerOptions) => YTPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerOptions {
  videoId: string;
  playerVars?: {
    autoplay?: number;
    controls?: number;
    disablekb?: number;
    fs?: number;
    modestbranding?: number;
    rel?: number;
    showinfo?: number;
    loop?: number;
    playlist?: string;
  };
  events?: {
    onReady?: (event: { target: YTPlayer }) => void;
    onStateChange?: (event: { data: number; target: YTPlayer }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

// Global music controller (exposed for ducking)
export const musicController = {
  player: null as YTPlayer | null,
  originalVolume: 50,
  isPlaying: false,

  getVolume(): number {
    return this.player?.getVolume() ?? this.originalVolume;
  },

  setVolume(value: number): void {
    if (this.player && typeof this.player.setVolume === 'function') {
      this.player.setVolume(Math.max(0, Math.min(100, value)));
    }
  },

  async duckVolume(targetVolume: number = 15, fadeMs: number = 400): Promise<void> {
    if (!this.player) return;

    const currentVolume = this.getVolume();
    this.originalVolume = currentVolume;

    // Fade down
    const steps = 10;
    const stepDuration = fadeMs / steps;
    const volumeStep = (currentVolume - targetVolume) / steps;

    for (let i = 0; i <= steps; i++) {
      const newVolume = Math.max(targetVolume, currentVolume - (volumeStep * i));
      this.setVolume(Math.round(newVolume));
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }

    console.log('[music-duck] volume ducked to', targetVolume);
  },

  async restoreVolume(fadeMs: number = 700): Promise<void> {
    if (!this.player) return;

    const currentVolume = this.getVolume();
    const targetVolume = this.originalVolume;

    // Fade up
    const steps = 10;
    const stepDuration = fadeMs / steps;
    const volumeStep = (targetVolume - currentVolume) / steps;

    for (let i = 0; i <= steps; i++) {
      const newVolume = Math.min(targetVolume, currentVolume + (volumeStep * i));
      this.setVolume(Math.round(newVolume));
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }

    console.log('[music-duck] volume restored to', targetVolume);
  },
};

interface OperationsMusicPlayerProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

// Default salon music
const DEFAULT_MUSIC_URL = 'https://youtu.be/zAiXGF6kp7g?si=REAv95Sbqz_gLTaL';

export function OperationsMusicPlayer({ isExpanded = false, onToggleExpand }: OperationsMusicPlayerProps) {
  const [youtubeUrl, setYoutubeUrl] = useState(DEFAULT_MUSIC_URL);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [volume, setVolume] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiReady, setIsApiReady] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load saved settings or use default
  useEffect(() => {
    const savedUrl = localStorage.getItem(MUSIC_URL_KEY);
    const savedVolume = localStorage.getItem(MUSIC_VOLUME_KEY);

    // Use saved URL or default
    const urlToUse = savedUrl || DEFAULT_MUSIC_URL;
    setYoutubeUrl(urlToUse);
    const id = extractVideoId(urlToUse);
    if (id) setVideoId(id);

    // Use saved volume or default 30%
    if (savedVolume) {
      const vol = parseInt(savedVolume, 10);
      if (!isNaN(vol)) {
        setVolume(vol);
        musicController.originalVolume = vol;
      }
    } else {
      musicController.originalVolume = 30;
    }
  }, []);

  // Load YouTube IFrame API
  useEffect(() => {
    if (window.YT) {
      setIsApiReady(true);
      return;
    }

    // Create script tag
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Callback when API is ready
    window.onYouTubeIframeAPIReady = () => {
      console.log('[music-player] YouTube API ready');
      setIsApiReady(true);
    };

    return () => {
      window.onYouTubeIframeAPIReady = undefined;
    };
  }, []);

  // Initialize player when videoId changes
  useEffect(() => {
    if (!isApiReady || !videoId || !containerRef.current) return;

    // Destroy existing player
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    // Create new player
    try {
      playerRef.current = new window.YT.Player('youtube-player-container', {
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          loop: 1,
          playlist: videoId,
        },
        events: {
          onReady: (event) => {
            console.log('[music-player] player ready');
            event.target.setVolume(volume);
            setIsLoading(false);
            setIsPlaying(true);

            // Update global controller
            musicController.player = event.target;
            musicController.isPlaying = true;
          },
          onStateChange: (event) => {
            const isNowPlaying = event.data === window.YT.PlayerState.PLAYING;
            setIsPlaying(isNowPlaying);
            musicController.isPlaying = isNowPlaying;
          },
          onError: (event) => {
            console.error('[music-player] player error:', event.data);
            setError('فشل تشغيل الفيديو. تأكد من صحة الرابط.');
            setIsLoading(false);
          },
        },
      });
    } catch (err) {
      console.error('[music-player] init error:', err);
      setError('فشل إنشاء المشغل');
      setIsLoading(false);
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
        musicController.player = null;
      }
    };
  }, [isApiReady, videoId]);

  // Extract YouTube video ID
  const extractVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
      /youtube\.com\/watch\?.*v=([^&\s]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    // If it's just an ID (11 characters)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url;
    }

    return null;
  };

  // Handle play
  const handlePlay = useCallback(() => {
    const id = extractVideoId(youtubeUrl);
    if (id) {
      setVideoId(id);
      localStorage.setItem(MUSIC_URL_KEY, youtubeUrl);
      setError(null);
    } else {
      setError('رابط YouTube غير صالح');
    }
  }, [youtubeUrl]);

  // Handle toggle play/pause
  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current) return;

    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  }, [isPlaying]);

  // Handle volume change
  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    localStorage.setItem(MUSIC_VOLUME_KEY, String(newVolume));
    musicController.originalVolume = newVolume;

    if (playerRef.current) {
      playerRef.current.setVolume(newVolume);
    }
  }, []);

  // Stop music
  const handleStop = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stopVideo();
    }
    setVideoId(null);
    setIsPlaying(false);
    musicController.player = null;
    musicController.isPlaying = false;
  }, []);

  const volumeIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Header - Always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-white" />
          <span className="text-white font-semibold text-sm">موسيقى الصالة</span>
          {isPlaying && (
            <span className="text-xs text-purple-200 bg-purple-800/50 px-2 py-0.5 rounded-full">
              تعمل
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-white" />
          ) : (
            <ChevronUp className="w-5 h-5 text-white" />
          )}
        </div>
      </div>

      {/* Hidden YouTube Player Container - always in DOM */}
      <div
        ref={containerRef}
        id="youtube-player-container"
        className="hidden"
      />

      {/* Expanded Content - Compact Controls */}
      {isExpanded && (
        <div className="p-3 space-y-3">
          {/* Compact Player Controls */}
          <div className="flex items-center gap-3">
            {/* Play/Pause Button */}
            <button
              onClick={handleTogglePlay}
              disabled={!videoId}
              className="flex items-center justify-center w-10 h-10 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white rounded-full transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </button>

            {/* Volume Slider */}
            <div className="flex items-center gap-2 flex-1">
              {React.createElement(volumeIcon, { className: 'w-4 h-4 text-gray-500' })}
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleVolumeChange(parseInt(e.target.value))}
                className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
              />
            </div>

            {/* Volume % */}
            <span className="text-xs text-gray-500 w-8">{volume}%</span>
          </div>

          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default OperationsMusicPlayer;
