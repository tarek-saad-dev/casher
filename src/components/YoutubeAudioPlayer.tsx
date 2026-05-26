'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Music } from 'lucide-react';

interface YoutubeAudioPlayerProps {
  videoId?: string;
  autoPlay?: boolean;
}

// Fixed origin to avoid hydration mismatch
const ORIGIN = 'http://localhost:3000';

export function YoutubeAudioPlayer({ 
  videoId = 'zAiXGF6kp7g', // New music video
  autoPlay = false 
}: YoutubeAudioPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Avoid hydration issues by only rendering iframe on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // YouTube embed URL with parameters for audio-only experience
  const embedUrl = `https://www.youtube.com/embed/${videoId}?` + new URLSearchParams({
    autoplay: autoPlay ? '1' : '0',
    mute: '0',
    controls: '0',
    disablekb: '1',
    fs: '0',
    modestbranding: '1',
    rel: '0',
    playsinline: '1',
    enablejsapi: '1',
    origin: ORIGIN,
  }).toString();

  const togglePlay = () => {
    if (!iframeRef.current) return;
    
    // Post message to YouTube iframe
    const message = JSON.stringify({
      event: 'command',
      func: isPlaying ? 'pauseVideo' : 'playVideo',
      args: []
    });
    
    iframeRef.current.contentWindow?.postMessage(message, '*');
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!iframeRef.current) return;
    
    const message = JSON.stringify({
      event: 'command',
      func: isMuted ? 'unMute' : 'mute',
      args: []
    });
    
    iframeRef.current.contentWindow?.postMessage(message, '*');
    setIsMuted(!isMuted);
  };

  useEffect(() => {
    // Listen for messages from YouTube iframe
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return;
      
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'onStateChange') {
          // 1 = playing, 2 = paused
          setIsPlaying(data.info === 1);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-lg px-3 py-2 shadow-lg">
      {/* Hidden iframe for audio - only render on client to avoid hydration mismatch */}
      {isClient && (
        <iframe
          ref={iframeRef}
          src={embedUrl}
          className="w-0 h-0 absolute opacity-0 pointer-events-none"
          allow="autoplay; encrypted-media"
          onLoad={() => setIsLoaded(true)}
        />
      )}
      
      {/* Music Icon */}
      <div className="flex items-center gap-1.5">
        <Music className={`w-4 h-4 ${isPlaying ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
        <span className="text-xs text-slate-300 font-medium">
          {isPlaying ? 'مشغل' : 'متوقف'}
        </span>
      </div>

      <div className="w-px h-4 bg-slate-700 mx-1" />

      {/* Controls */}
      <button
        onClick={togglePlay}
        disabled={!isLoaded}
        className="p-1.5 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50"
        title={isPlaying ? 'إيقاف' : 'تشغيل'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 text-amber-400" />
        ) : (
          <Play className="w-4 h-4 text-green-400" />
        )}
      </button>

      <button
        onClick={toggleMute}
        disabled={!isLoaded}
        className="p-1.5 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50"
        title={isMuted ? 'إلغاء الكتم' : 'كتم'}
      >
        {isMuted ? (
          <VolumeX className="w-4 h-4 text-slate-400" />
        ) : (
          <Volume2 className="w-4 h-4 text-slate-300" />
        )}
      </button>
    </div>
  );
}
