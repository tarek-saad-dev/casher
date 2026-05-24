'use client';

import { useState, useEffect } from 'react';
import { Volume2, VolumeX, CheckCircle } from 'lucide-react';

interface Props {
  enabled: boolean;
  onEnable: () => void;
  onDisable?: () => void;
}

export function VoiceEnableBanner({ enabled, onEnable, onDisable }: Props) {
  const [showBanner, setShowBanner] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);

  // Check if we should show the banner
  useEffect(() => {
    // Show banner if voice is not enabled yet
    if (!enabled) {
      setShowBanner(true);
    } else {
      setShowBanner(false);
    }
  }, [enabled]);

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      onEnable();
      // Banner will hide automatically via useEffect when enabled prop changes
    } catch (e) {
      console.error('[VoiceBanner] Enable failed:', e);
    } finally {
      setIsEnabling(false);
    }
  };

  // Don't render if no interaction needed
  if (!showBanner && !enabled) return null;

  // Show enabled status
  if (enabled) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#22c55e20] border border-[#22c55e40]">
        <CheckCircle size={14} style={{ color: '#22c55e' }} />
        <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
          النداء الصوتي مفعل
        </span>
        {onDisable && (
          <button
            onClick={onDisable}
            className="mr-2 p-0.5 rounded hover:bg-[#22c55e30] transition-colors"
            title="إيقاف النداء الصوتي"
          >
            <VolumeX size={12} style={{ color: '#22c55e' }} />
          </button>
        )}
      </div>
    );
  }

  // Show enable banner
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[#d4af3720] border border-[#d4af3740]">
      <Volume2 size={18} style={{ color: '#d4af37' }} />
      <div className="flex-1">
        <p className="text-xs font-medium text-white">
          تفعيل النداء الصوتي التلقائي
        </p>
        <p className="text-[10px] text-zinc-400">
          اضغط لتفعيل النداء الصوتي للأدوار المتوقعة
        </p>
      </div>
      <button
        onClick={handleEnable}
        disabled={isEnabling}
        className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
        style={{ background: '#d4af37', color: '#1a1a1a' }}
      >
        {isEnabling ? 'جاري التفعيل...' : 'تفعيل'}
      </button>
    </div>
  );
}
