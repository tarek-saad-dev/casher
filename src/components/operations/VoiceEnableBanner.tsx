'use client';

import { useState, useEffect } from 'react';
import { Volume2, VolumeX, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Props {
  enabled: boolean;
  onEnable: () => void;
  onDisable?: () => void;
  compact?: boolean;
  className?: string;
}

export function VoiceEnableBanner({ enabled, onEnable, onDisable, compact = false, className }: Props) {
  const [showBanner, setShowBanner] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  useEffect(() => {
    setShowBanner(!enabled);
  }, [enabled]);

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      onEnable();
    } finally {
      setIsEnabling(false);
    }
  };

  if (!showBanner && !enabled) return null;

  if (enabled) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/10 px-3',
          compact ? 'w-full' : 'h-11 min-h-[44px] md:h-10 md:min-h-[40px]',
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle className="size-4 shrink-0 text-success" />
          <span className="truncate text-sm font-medium text-success">النداء الصوتي مفعل</span>
        </div>
        {onDisable && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onDisable}
            className="shrink-0 text-success hover:bg-success/15 hover:text-success"
            aria-label="إيقاف النداء الصوتي"
            title="إيقاف النداء الصوتي"
          >
            <VolumeX className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3',
        compact ? 'w-full justify-between' : 'gap-3 px-4 py-2',
        !compact && 'h-11 min-h-[44px] md:h-10 md:min-h-[40px]',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Volume2 className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">النداء الصوتي</p>
          {!compact && (
            <p className="text-[11px] text-muted-foreground">اضغط لتفعيل النداء التلقائي</p>
          )}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={handleEnable}
        disabled={isEnabling}
        className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isEnabling ? '...' : 'تفعيل'}
      </Button>
    </div>
  );
}
