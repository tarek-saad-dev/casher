'use client';

import { useEffect, useState } from 'react';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { cn } from '@/lib/utils';
import { musicController } from './OperationsMusicPlayerEnhanced';

interface Props {
  voiceEnabled: boolean;
  musicExpanded: boolean;
  onToggleVoice: () => void;
  onToggleMusic: () => void;
  className?: string;
}

const iconBtnBase =
  'relative inline-flex size-6 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-md border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:size-11 md:min-h-[44px] md:min-w-[44px] md:rounded-lg';

export function EnvironmentControls({
  voiceEnabled,
  musicExpanded,
  onToggleVoice,
  onToggleMusic,
  className,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const sync = () => setIsPlaying(musicController.isPlaying);
    sync();
    const id = window.setInterval(sync, 1500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={cn('flex shrink-0 items-center gap-0.5 md:gap-1.5', className)}>
      <button
        type="button"
        onClick={onToggleVoice}
        aria-pressed={voiceEnabled}
        aria-label={voiceEnabled ? 'النداء الصوتي مفعل' : 'النداء الصوتي متوقف'}
        title={voiceEnabled ? 'النداء الصوتي مفعل' : 'النداء الصوتي متوقف'}
        className={cn(
          iconBtnBase,
          voiceEnabled
            ? 'border-success/35 bg-success/10 text-success hover:bg-success/15'
            : 'border-border/80 bg-surface-muted/40 text-muted-foreground hover:bg-surface-muted/70',
        )}
      >
        {voiceEnabled ? <Volume2 className="size-3 md:size-4" /> : <VolumeX className="size-3 md:size-4" />}
        {voiceEnabled && (
          <span
            className="absolute end-0.5 top-0.5 size-1 rounded-full bg-success ring-1 ring-card md:end-1 md:top-1 md:size-1.5 md:ring-2"
            aria-hidden
          />
        )}
      </button>

      <button
        type="button"
        id="salon-music-toggle"
        onClick={onToggleMusic}
        aria-expanded={musicExpanded}
        aria-controls="salon-music-panel"
        aria-label="موسيقى الصالة"
        title="موسيقى الصالة"
        className={cn(
          iconBtnBase,
          musicExpanded
            ? 'border-primary/35 bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-border/80 bg-surface-muted/40 text-muted-foreground hover:bg-surface-muted/70',
        )}
      >
        <Music className="size-3 md:size-4" />
        {isPlaying && (
          <span
            className="absolute end-0.5 top-0.5 size-1 animate-pulse rounded-full bg-primary ring-1 ring-card md:end-1 md:top-1 md:size-1.5 md:ring-2"
            aria-hidden
          />
        )}
      </button>
    </div>
  );
}
