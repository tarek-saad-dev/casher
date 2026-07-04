'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Music, Play, Pause, Volume2, Volume1, VolumeX, ChevronDown, ChevronUp,
  Search, X, ExternalLink, History, Youtube, AlertCircle, Link as LinkIcon,
  SkipForward
} from 'lucide-react';

// Storage keys
const MUSIC_RECENT_KEY = 'operations-music-recent';
const MUSIC_VOLUME_KEY = 'operations-music-volume';

// Types
interface MusicItem {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  channelTitle?: string;
  url: string;
  playedAt: string;
}

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  description?: string;
}

// Import YTPlayer type from original component
import type { YTPlayer } from './OperationsMusicPlayer';

// Global music controller (exposed for ducking)
export const musicController = {
  player: null as YTPlayer | null,
  originalVolume: 50,
  isPlaying: false,
  currentVideoId: null as string | null,

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

    const steps = 10;
    const stepDuration = fadeMs / steps;
    const volumeStep = (currentVolume - targetVolume) / steps;

    for (let i = 0; i <= steps; i++) {
      const newVolume = Math.max(targetVolume, currentVolume - (volumeStep * i));
      this.setVolume(Math.round(newVolume));
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
  },

  async restoreVolume(fadeMs: number = 700): Promise<void> {
    if (!this.player) return;

    const currentVolume = this.getVolume();
    const targetVolume = this.originalVolume;

    const steps = 10;
    const stepDuration = fadeMs / steps;
    const volumeStep = (targetVolume - currentVolume) / steps;

    for (let i = 0; i <= steps; i++) {
      const newVolume = Math.min(targetVolume, currentVolume + (volumeStep * i));
      this.setVolume(Math.round(newVolume));
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
  },
};

interface OperationsMusicPlayerEnhancedProps {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  embedded?: boolean;
}

export function OperationsMusicPlayerEnhanced({ isExpanded = false, onToggleExpand, embedded = false }: OperationsMusicPlayerEnhancedProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [recentItems, setRecentItems] = useState<MusicItem[]>([]);
  const [currentItem, setCurrentItem] = useState<MusicItem | null>(null);
  const [playlistQueue, setPlaylistQueue] = useState<MusicItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [volume, setVolume] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isApiReady, setIsApiReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'recent'>('recent');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load saved settings and recent items
  useEffect(() => {
    const savedVolume = localStorage.getItem(MUSIC_VOLUME_KEY);
    const savedRecent = localStorage.getItem(MUSIC_RECENT_KEY);

    if (savedVolume) {
      const vol = parseInt(savedVolume, 10);
      if (!isNaN(vol)) {
        setVolume(vol);
        musicController.originalVolume = vol;
      }
    }

    if (savedRecent) {
      try {
        const parsed = JSON.parse(savedRecent);
        setRecentItems(parsed.slice(0, 10));
      } catch {
        console.error('Failed to parse recent music');
      }
    }
  }, []);

  // Load YouTube IFrame API
  useEffect(() => {
    if (window.YT) {
      setIsApiReady(true);
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      setIsApiReady(true);
    };

    return () => {
      window.onYouTubeIframeAPIReady = undefined;
    };
  }, []);

  // Save recent items to localStorage
  const saveRecentItems = useCallback((items: MusicItem[]) => {
    localStorage.setItem(MUSIC_RECENT_KEY, JSON.stringify(items.slice(0, 10)));
  }, []);

  // Add item to recent
  const addToRecent = useCallback((videoId: string, title: string, thumbnailUrl?: string, channelTitle?: string) => {
    const newItem: MusicItem = {
      videoId,
      title,
      thumbnailUrl,
      channelTitle,
      url: `https://youtu.be/${videoId}`,
      playedAt: new Date().toISOString(),
    };

    setRecentItems(prev => {
      const filtered = prev.filter(item => item.videoId !== videoId);
      const updated = [newItem, ...filtered].slice(0, 10);
      saveRecentItems(updated);
      return updated;
    });

    return newItem;
  }, [saveRecentItems]);

  // Play next video in queue - defined early to avoid circular dependency
  const playNextRef = useRef<() => void>(() => {});

  const playNext = useCallback(() => {
    if (playlistQueue.length === 0 || currentIndex < 0) return;

    const nextIndex = currentIndex + 1;
    if (nextIndex < playlistQueue.length) {
      const nextItem = playlistQueue[nextIndex];
      // Use loadVideoById if player exists, otherwise initPlayer will be called via ref
      if (playerRef.current && playerRef.current.loadVideoById) {
        playerRef.current.loadVideoById(nextItem.videoId);
      }
      setCurrentItem(nextItem);
      setCurrentIndex(nextIndex);
    } else {
      // End of playlist - stop
      console.log('[music] end of playlist');
    }
  }, [playlistQueue, currentIndex]);

  // Extract YouTube video ID from various URL formats
  const extractVideoId = useCallback((url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\s?\/]+)/,
      /youtube\.com\/watch\?.*v=([^&\s]+)/,
      /youtube\.com\/playlist\?list=([^&\s]+)/,
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
  }, []);

  // Initialize player
  const initPlayer = useCallback((videoId: string) => {
    if (!isApiReady || !containerRef.current) return;

    // Destroy existing player
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    setIsLoading(true);
    setError(null);

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
            event.target.setVolume(volume);
            setIsLoading(false);
            setIsPlaying(true);
            musicController.player = event.target;
            musicController.currentVideoId = videoId;
            musicController.isPlaying = true;
          },
          onStateChange: (event) => {
            const isNowPlaying = event.data === window.YT.PlayerState.PLAYING;
            setIsPlaying(isNowPlaying);
            musicController.isPlaying = isNowPlaying;

            // Auto-advance to next video when current ends
            if (event.data === window.YT.PlayerState.ENDED) {
              console.log('[music] video ended, playing next...');
              playNextRef.current?.();
            }
          },
          onError: () => {
            setError('فشل تشغيل الفيديو. تأكد من صحة الرابط.');
            setIsLoading(false);
          },
        },
      });
    } catch (err) {
      setError('فشل إنشاء المشغل');
      setIsLoading(false);
    }
  }, [isApiReady, volume]);

  // Update playNext ref when function changes
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  // Play video and manage playlist
  const playVideoWithQueue = useCallback((item: MusicItem, queue?: MusicItem[], startIndex?: number) => {
    // If player already initialized, just load new video
    if (playerRef.current && playerRef.current.loadVideoById) {
      playerRef.current.loadVideoById(item.videoId);
    } else {
      // Otherwise init new player
      initPlayer(item.videoId);
    }
    setCurrentItem(item);

    // If queue provided, set it and the index
    if (queue && queue.length > 0) {
      setPlaylistQueue(queue);
      setCurrentIndex(startIndex ?? queue.findIndex(q => q.videoId === item.videoId));
    } else {
      // Single item - clear queue
      setPlaylistQueue([]);
      setCurrentIndex(-1);
    }
  }, [initPlayer]);

  // Play video (legacy - single video)
  const playVideo = useCallback((videoId: string, title?: string, thumbnailUrl?: string, channelTitle?: string) => {
    const item = addToRecent(videoId, title || 'موسيقى صالة', thumbnailUrl, channelTitle);
    playVideoWithQueue(item);
  }, [addToRecent, playVideoWithQueue]);

  // Play all recent items as a queue starting from specific index
  const playFromQueue = useCallback((items: MusicItem[], startIndex: number) => {
    if (startIndex < 0 || startIndex >= items.length) return;

    const item = items[startIndex];
    playVideoWithQueue(item, items, startIndex);
  }, [playVideoWithQueue]);

  // Check if input is a YouTube URL
  const isYouTubeUrl = useCallback((input: string): boolean => {
    const urlPatterns = [
      /youtube\.com\/watch\?v=/i,
      /youtu\.be\//i,
      /youtube\.com\/embed\//i,
      /youtube\.com\/shorts\//i,
      /youtube\.com\/playlist\?list=/i,
    ];
    return urlPatterns.some(pattern => pattern.test(input));
  }, []);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    // If it's a YouTube URL, play it directly without API call
    if (isYouTubeUrl(searchQuery)) {
      const videoId = extractVideoId(searchQuery);
      if (videoId) {
        playVideo(videoId, 'فيديو من رابط');
        setSearchQuery(''); // Clear the search input
        return;
      }
    }

    // Otherwise, perform a text search (requires API key)
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const response = await fetch(`/api/operations/music/youtube-search?q=${encodeURIComponent(searchQuery)}&maxResults=8`);
      const data = await response.json();

      if (!data.ok) {
        if (data.error === 'missing_youtube_api_key') {
          setSearchError('بحث YouTube يحتاج API Key — يمكنك لصق رابط مباشر');
        } else {
          setSearchError(data.message || 'فشل البحث');
        }
        return;
      }

      setSearchResults(data.results || []);
    } catch {
      setSearchError('فشل الاتصال بالخادم');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, isYouTubeUrl, extractVideoId, playVideo]);

  // Handle URL paste
  const handleUrlSubmit = useCallback(() => {
    const videoId = extractVideoId(urlInput);
    if (videoId) {
      playVideo(videoId, 'فيديو من رابط');
      setUrlInput('');
      setShowUrlInput(false);
      setError(null);
    } else {
      setError('رابط YouTube غير صالح');
    }
  }, [urlInput, extractVideoId, playVideo]);

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
    setIsPlaying(false);
    musicController.isPlaying = false;
    setCurrentItem(null);
    musicController.currentVideoId = null;
  }, []);

  // Play from recent
  const playFromRecent = useCallback((item: MusicItem) => {
    playVideo(item.videoId, item.title, item.thumbnailUrl, item.channelTitle);
  }, [playVideo]);

  // Remove from recent
  const removeFromRecent = useCallback((videoId: string) => {
    setRecentItems(prev => {
      const updated = prev.filter(item => item.videoId !== videoId);
      saveRecentItems(updated);
      return updated;
    });
  }, [saveRecentItems]);

  const volumeIcon = volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const showPanel = embedded ? isExpanded : isExpanded;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      {!embedded && (
        <div
          className="flex cursor-pointer items-center justify-between px-4 py-3"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 70%, #6366F1), color-mix(in srgb, var(--primary) 45%, #4F46E5))' }}
          onClick={onToggleExpand}
        >
          <div className="flex items-center gap-2">
            <Music className="size-5 text-primary-foreground" />
            <span className="text-sm font-semibold text-primary-foreground">موسيقى الصالة</span>
            {currentItem && (
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs text-primary-foreground/90">
                {isPlaying ? 'تعمل' : 'متوقفة'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="size-5 text-primary-foreground" />
            ) : (
              <ChevronUp className="size-5 text-primary-foreground" />
            )}
          </div>
        </div>
      )}

      {/* Hidden YouTube Player Container */}
      <div
        ref={containerRef}
        id="youtube-player-container"
        className="hidden"
      />

      {/* Expanded Content */}
      {showPanel && (
        <div className="space-y-4 p-4">
          {/* Current Playing Info */}
          {currentItem && (
            <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              {currentItem.thumbnailUrl ? (
                <img src={currentItem.thumbnailUrl} alt="" className="w-16 h-12 object-cover rounded" />
              ) : (
                <div className="w-16 h-12 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <Youtube className="w-6 h-6 text-gray-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{currentItem.title}</p>
                <p className="text-xs text-gray-400">{currentItem.channelTitle}</p>
              </div>
            </div>
          )}

          {/* Player Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTogglePlay}
              disabled={!currentItem}
              className="flex items-center justify-center w-10 h-10 rounded-full transition-colors disabled:opacity-50"
              style={{ background: currentItem ? '#8B5CF6' : '#4b5563' }}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" />
              )}
            </button>

            <button
              onClick={handleStop}
              disabled={!currentItem}
              className="flex items-center justify-center w-8 h-8 rounded-full transition-colors disabled:opacity-50"
              style={{ background: '#374151' }}
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>

            {/* Next Button - only show if there are more items in queue */}
            <button
              onClick={playNext}
              disabled={!currentItem || playlistQueue.length === 0 || currentIndex >= playlistQueue.length - 1}
              className="flex items-center justify-center w-8 h-8 rounded-full transition-colors disabled:opacity-30"
              style={{ background: currentIndex < playlistQueue.length - 1 ? 'rgba(139,92,246,0.3)' : '#374151' }}
              title={currentIndex < playlistQueue.length - 1 ? `التالي: ${playlistQueue[currentIndex + 1]?.title?.slice(0, 15)}...` : 'لا يوجد تالي'}
            >
              <SkipForward className="w-4 h-4 text-purple-400" />
            </button>

            <div className="flex items-center gap-2 flex-1">
              {React.createElement(volumeIcon, { className: 'w-4 h-4 text-gray-400' })}
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleVolumeChange(parseInt(e.target.value))}
                className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer"
                style={{ background: '#374151', accentColor: '#8B5CF6' }}
              />
              <span className="text-xs text-gray-400 w-8">{volume}%</span>
            </div>
          </div>

          {/* URL Paste Option */}
          <div className="space-y-2">
            <button
              onClick={() => setShowUrlInput(!showUrlInput)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              {showUrlInput ? 'إخفاء' : 'أو الصق رابط YouTube مباشرة'}
            </button>

            {showUrlInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://youtu.be/... أو https://youtube.com/watch?v=..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border text-right"
                  style={{ background: '#141418', borderColor: 'rgba(212,175,55,0.3)', color: '#fff' }}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                />
                <button
                  onClick={handleUrlSubmit}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: '#8B5CF6', color: '#fff' }}
                >
                  تشغيل
                </button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
            <button
              onClick={() => setActiveTab('recent')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: activeTab === 'recent' ? '#8B5CF6' : '#9CA3AF',
                borderBottom: activeTab === 'recent' ? '2px solid #8B5CF6' : 'none'
              }}
            >
              <History className="w-3.5 h-3.5" />
              آخر تشغيل
              {recentItems.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full" style={{ background: 'rgba(139,92,246,0.2)', color: '#8B5CF6' }}>
                  {recentItems.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: activeTab === 'search' ? '#8B5CF6' : '#9CA3AF',
                borderBottom: activeTab === 'search' ? '2px solid #8B5CF6' : 'none'
              }}
            >
              <Search className="w-3.5 h-3.5" />
              بحث YouTube
            </button>
          </div>

          {/* Recent Tab Content */}
          {activeTab === 'recent' && (
            <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {recentItems.length === 0 ? (
                <div className="text-center py-4 text-sm text-gray-500">
                  لا يوجد عناصر سابقة
                </div>
              ) : (
                <>
                  {/* Queue indicator */}
                  {playlistQueue.length > 0 && currentIndex >= 0 && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs" style={{ background: 'rgba(139,92,246,0.15)', color: '#8B5CF6' }}>
                      <span>قائمة التشغيل:</span>
                      <span className="font-medium">{currentIndex + 1} / {playlistQueue.length}</span>
                      {currentIndex < playlistQueue.length - 1 && (
                        <span className="text-[10px] opacity-70">(التالي: {playlistQueue[currentIndex + 1]?.title?.slice(0, 20)}...)</span>
                      )}
                    </div>
                  )}
                  {recentItems.map((item, index) => (
                    <div
                      key={item.videoId}
                      className="flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer group"
                      style={{
                        background: currentItem?.videoId === item.videoId
                          ? 'rgba(139, 92, 246, 0.2)'
                          : 'rgba(255,255,255,0.05)',
                        border: currentItem?.videoId === item.videoId ? '1px solid rgba(139, 92, 246, 0.5)' : 'none'
                      }}
                      onClick={() => playFromQueue(recentItems, index)}
                    >
                      {/* Index number */}
                      <span className="text-xs text-gray-500 w-4 text-center">{index + 1}</span>

                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt="" className="w-12 h-9 object-cover rounded" />
                      ) : (
                        <div className="w-12 h-9 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.1)' }}>
                          <Youtube className="w-5 h-5 text-gray-500" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white truncate">{item.title}</p>
                        <p className="text-[10px] text-gray-500">
                          {new Date(item.playedAt).toLocaleDateString('ar-EG')}
                        </p>
                      </div>

                      {/* Playing indicator */}
                      {currentItem?.videoId === item.videoId && isPlaying && (
                        <div className="flex items-center gap-0.5">
                          <span className="w-1 h-3 bg-purple-500 animate-pulse rounded-full" style={{ animationDelay: '0ms' }} />
                          <span className="w-1 h-3 bg-purple-500 animate-pulse rounded-full" style={{ animationDelay: '150ms' }} />
                          <span className="w-1 h-3 bg-purple-500 animate-pulse rounded-full" style={{ animationDelay: '300ms' }} />
                        </div>
                      )}

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); playFromQueue(recentItems, index); }}
                          className="p-1.5 rounded"
                          style={{ background: 'rgba(139,92,246,0.2)' }}
                        >
                          <Play className="w-3 h-3" style={{ color: '#8B5CF6' }} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFromRecent(item.videoId); }}
                          className="p-1.5 rounded"
                          style={{ background: 'rgba(239,68,68,0.2)' }}
                        >
                          <X className="w-3 h-3 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Search Tab Content */}
          {activeTab === 'search' && (
            <div className="space-y-3">
              {/* Search Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="ابحث في YouTube..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border text-right"
                  style={{ background: '#141418', borderColor: 'rgba(212,175,55,0.3)', color: '#fff' }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button
                  onClick={handleSearch}
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ background: '#8B5CF6', color: '#fff' }}
                >
                  {isSearching ? 'جاري البحث...' : 'بحث'}
                </button>
              </div>

              {/* Search Error */}
              {searchError && (
                <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {searchError}
                </div>
              )}

              {/* Search Results */}
              <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
                {searchResults.map((result) => (
                  <div
                    key={result.videoId}
                    className="flex items-start gap-3 p-2 rounded-lg transition-colors cursor-pointer hover:bg-white/5"
                    onClick={() => playVideo(result.videoId, result.title, result.thumbnailUrl, result.channelTitle)}
                  >
                    <img src={result.thumbnailUrl} alt="" className="w-20 h-14 object-cover rounded" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white line-clamp-2">{result.title}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{result.channelTitle}</p>
                    </div>
                    <button
                      className="p-1.5 rounded self-center"
                      style={{ background: 'rgba(139,92,246,0.2)' }}
                    >
                      <Play className="w-3 h-3" style={{ color: '#8B5CF6' }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 text-center">{error}</p>
          )}

          {/* Loading */}
          {isLoading && (
            <p className="text-xs text-gray-500 text-center">جاري التحميل...</p>
          )}
        </div>
      )}
    </div>
  );
}

export default OperationsMusicPlayerEnhanced;
