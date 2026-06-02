'use client';

import { useCallback } from 'react';
import { musicController } from '@/components/operations/OperationsMusicPlayerEnhanced';

interface DuckOptions {
  targetVolume?: number;
  fadeMs?: number;
}

interface RestoreOptions {
  fadeMs?: number;
}

/**
 * Hook for music ducking - controls music volume during voice announcements
 */
export function useMusicDucking() {
  /**
   * Duck (lower) the music volume before an announcement
   */
  const duckMusic = useCallback(async (options: DuckOptions = {}): Promise<void> => {
    const { targetVolume = 15, fadeMs = 400 } = options;

    // Check if music player is active
    if (!musicController.player) {
      console.log('[music-duck] no active player, skipping duck');
      return;
    }

    console.log('[music-duck] ducking volume to', targetVolume);
    await musicController.duckVolume(targetVolume, fadeMs);
  }, []);

  /**
   * Restore music volume after an announcement
   */
  const restoreMusic = useCallback(async (options: RestoreOptions = {}): Promise<void> => {
    const { fadeMs = 700 } = options;

    // Check if music player is active
    if (!musicController.player) {
      console.log('[music-duck] no active player, skipping restore');
      return;
    }

    console.log('[music-duck] restoring volume to', musicController.originalVolume);
    await musicController.restoreVolume(fadeMs);
  }, []);

  /**
   * Check if music is currently playing
   */
  const isMusicPlaying = useCallback((): boolean => {
    return musicController.isPlaying && !!musicController.player;
  }, []);

  /**
   * Get current music volume
   */
  const getCurrentVolume = useCallback((): number => {
    return musicController.getVolume();
  }, []);

  return {
    duckMusic,
    restoreMusic,
    isMusicPlaying,
    getCurrentVolume,
  };
}

export default useMusicDucking;
