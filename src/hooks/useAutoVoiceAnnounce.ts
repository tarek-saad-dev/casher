'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { stopQueueSpeech } from '@/lib/queueVoice';
import { speakWithAzure } from '@/lib/queueVoice';
import type { AnnouncementPart } from '@/lib/chairMapping';
import { musicController } from '@/components/operations/OperationsMusicPlayer';

interface Announcement {
  queueTicketId: number;
  ticketCode: string;
  customerName: string | null;
  customerMobile: string | null;
  empId: number;
  empName: string | null;
  chairNumber: number | null;
  chairDisplayText: string;
  estimatedStartTime: string;
  announcementText: string;
  announcementTextAr: string;
  announcementTextEn: string;
  announcementSequence: AnnouncementPart[];
}

interface UseAutoVoiceAnnounceOptions {
  date: string;
  enabled: boolean;
  pollIntervalMs?: number;
  onAnnouncementStart?: (announcement: Announcement) => void;
  onAnnouncementEnd?: (announcement: Announcement) => void;
  onError?: (error: string) => void;
}

// Storage key for voice enable status
const VOICE_ENABLED_KEY = 'operationsVoiceEnabled';

export function useAutoVoiceAnnounce(options: UseAutoVoiceAnnounceOptions) {
  const { date, enabled, pollIntervalMs = 10000, onAnnouncementStart, onAnnouncementEnd, onError } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [lastAnnouncedId, setLastAnnouncedId] = useState<number | null>(null);
  
  // Three tracking sets to prevent duplicate announcements
  const playingTicketIdsRef = useRef<Set<number>>(new Set());   // Currently playing
  const announcedTicketIdsRef = useRef<Set<number>>(new Set()); // Already announced (persisted)
  const queuedTicketIdsRef = useRef<Set<number>>(new Set());    // In queue waiting
  
  // Polling control refs
  const isProcessingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<Announcement[]>([]);
  const pollingStartedRef = useRef(false);

  // Clear announced IDs when date changes
  useEffect(() => {
    console.log('[auto-voice] date changed, clearing tracking sets');
    announcedTicketIdsRef.current.clear();
    playingTicketIdsRef.current.clear();
    queuedTicketIdsRef.current.clear();
    queueRef.current = [];
    setLastAnnouncedId(null);
  }, [date]);

  // Helper to play announcement sequence
  const playAnnouncementSequence = useCallback(async (
    sequence: AnnouncementPart[],
    ticketId: number,
    ticketCode: string
  ): Promise<void> => {
    console.log(`[auto-voice] play start ${ticketCode} (${ticketId}) - ${sequence.length} parts`);
    
    for (let i = 0; i < sequence.length; i++) {
      const part = sequence[i];
      console.log(`[auto-voice] playing part ${i + 1}/${sequence.length} for ${ticketCode} (${part.lang})`);

      try {
        // Play each part with appropriate voice using Azure only
        await speakWithAzure(part.text, {
          voiceName: part.lang === 'ar-EG' ? 'ar-EG-SalmaNeural' : 'en-US-JennyNeural',
          locale: part.lang,
          rate: part.rate,
          pitch: part.pitch,
        });
        console.log(`[auto-voice] part ${i + 1} completed for ${ticketCode}`);
      } catch (err) {
        console.error(`[auto-voice] Azure failed for ${ticketCode} part ${i + 1}:`, err);
        // Don't fallback to browser - just throw the error
        throw err;
      }

      // Small pause between parts (except after last)
      if (i < sequence.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`[auto-voice] play end ${ticketCode} (${ticketId})`);
  }, []);

  // Process announcement queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;

    isProcessingRef.current = true;
    setIsPlaying(true);

    const announcement = queueRef.current.shift()!;
    const ticketId = announcement.queueTicketId;
    const ticketCode = announcement.ticketCode;

    // Mark as playing and remove from queued
    playingTicketIdsRef.current.add(ticketId);
    queuedTicketIdsRef.current.delete(ticketId);
    
    console.log(`[auto-voice] processing start ${ticketCode} (${ticketId})`);
    console.log(`[auto-voice] sets status: playing=[${Array.from(playingTicketIdsRef.current).join(',')}] announced=[${Array.from(announcedTicketIdsRef.current).join(',')}] queued=[${Array.from(queuedTicketIdsRef.current).join(',')}]`);

    try {
      onAnnouncementStart?.(announcement);

      // Duck music volume before announcement (very low - almost silent)
      console.log(`[auto-voice] ducking music before announcement ${ticketCode}`);
      await musicController.duckVolume(5, 400);

      // Play announcement sequence (Arabic once, English once)
      if (announcement.announcementSequence && announcement.announcementSequence.length > 0) {
        await playAnnouncementSequence(announcement.announcementSequence, ticketId, ticketCode);
      } else {
        // Fallback to legacy single announcement
        console.log(`[auto-voice] legacy announcement ${ticketCode}`);
        await speakWithAzure(announcement.announcementText || `دور ${ticketCode}`, {
          voiceName: 'ar-EG-SalmaNeural',
          locale: 'ar-EG',
          rate: '-5%',
        });
      }

      // Mark as announced on server AFTER voice completes
      console.log(`[auto-voice] mark announced ${ticketCode} (${ticketId})`);
      const res = await fetch(`/api/operations/queue/${ticketId}/announce`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.warn(`[auto-voice] mark failed ${ticketCode}:`, await res.text());
      } else {
        console.log(`[auto-voice] mark success ${ticketCode}`);
      }

      // Move from playing to announced
      playingTicketIdsRef.current.delete(ticketId);
      announcedTicketIdsRef.current.add(ticketId);
      setLastAnnouncedId(ticketId);

      onAnnouncementEnd?.(announcement);
    } catch (err) {
      console.error(`[auto-voice] announcement failed ${ticketCode}:`, err);
      onError?.(err instanceof Error ? err.message : 'فشل تشغيل النداء');
    } finally {
      // Restore music volume (even if announcement failed)
      console.log(`[auto-voice] restoring music after announcement ${ticketCode}`);
      await musicController.restoreVolume(700);

      // Always remove from playing
      playingTicketIdsRef.current.delete(ticketId);
      isProcessingRef.current = false;
      setIsPlaying(false);

      console.log(`[auto-voice] processing end ${ticketCode}`);
      console.log(`[auto-voice] sets after: playing=[${Array.from(playingTicketIdsRef.current).join(',')}] announced=[${Array.from(announcedTicketIdsRef.current).join(',')}] queued=[${Array.from(queuedTicketIdsRef.current).join(',')}]`);

      // Process next in queue if any
      if (queueRef.current.length > 0) {
        setTimeout(() => processQueue(), 500);
      }
    }
  }, [onAnnouncementStart, onAnnouncementEnd, onError, playAnnouncementSequence]);

  // Fetch due announcements
  const fetchAnnouncements = useCallback(async () => {
    if (!enabled) {
      console.log('[auto-voice] fetch skipped - not enabled');
      return;
    }
    
    // Skip if currently processing to avoid race conditions
    if (isProcessingRef.current) {
      console.log('[auto-voice] fetch skipped - processing in progress');
      return;
    }

    try {
      console.log(`[auto-voice] fetching announcements for ${date}`);
      const res = await fetch(`/api/operations/queue/due-announcements?date=${date}`);
      if (!res.ok) throw new Error('فشل جلب النداءات');

      const data = await res.json();
      if (!data.ok || !data.announcements) {
        console.log('[auto-voice] no announcements in response');
        return;
      }

      console.log(`[auto-voice] fetched ${data.announcements.length} announcements:`, 
        data.announcements.map((a: Announcement) => a.ticketCode).join(', '));

      // Filter out already tracked tickets (playing, announced, or queued)
      const newAnnouncements = data.announcements.filter((a: Announcement) => {
        const ticketId = a.queueTicketId;
        
        // Check all three tracking sets
        if (playingTicketIdsRef.current.has(ticketId)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=playing`);
          return false;
        }
        if (queuedTicketIdsRef.current.has(ticketId)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=queued`);
          return false;
        }
        if (announcedTicketIdsRef.current.has(ticketId)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=announced`);
          return false;
        }
        
        return true;
      });

      console.log(`[auto-voice] ${newAnnouncements.length} new announcements after filtering`);

      if (newAnnouncements.length > 0) {
        // Add to tracking and queue
        newAnnouncements.forEach((a: Announcement) => {
          console.log(`[auto-voice] queue ${a.ticketCode} (${a.queueTicketId})`);
          queuedTicketIdsRef.current.add(a.queueTicketId);
          queueRef.current.push(a);
        });
        
        console.log(`[auto-voice] sets after queue: playing=[${Array.from(playingTicketIdsRef.current).join(',')}] announced=[${Array.from(announcedTicketIdsRef.current).join(',')}] queued=[${Array.from(queuedTicketIdsRef.current).join(',')}]`);
        
        // Start processing if not already
        processQueue();
      }
    } catch (err) {
      console.error('[auto-voice] fetch error:', err);
    }
  }, [date, enabled, processQueue]);

  // Start polling when enabled - with React Strict Mode protection
  useEffect(() => {
    if (!enabled) {
      if (pollTimerRef.current) {
        console.log('[auto-voice] polling interval cleared (disabled)');
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollingStartedRef.current = false;
      return;
    }

    // Prevent double interval creation (React Strict Mode)
    if (pollingStartedRef.current) {
      console.log('[auto-voice] polling already started, skipping');
      return;
    }

    console.log('[auto-voice] polling interval created');
    pollingStartedRef.current = true;

    // Initial fetch
    fetchAnnouncements();

    // Start polling
    pollTimerRef.current = setInterval(fetchAnnouncements, pollIntervalMs);

    return () => {
      console.log('[auto-voice] polling interval cleanup');
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollingStartedRef.current = false;
    };
  }, [enabled, pollIntervalMs, fetchAnnouncements]);

  // Manual re-announce function
  const reannounce = useCallback(async (ticketId: number) => {
    try {
      console.log(`[auto-voice] reannounce request ${ticketId}`);
      
      // Remove from all tracking sets to allow re-announcement
      announcedTicketIdsRef.current.delete(ticketId);
      playingTicketIdsRef.current.delete(ticketId);
      queuedTicketIdsRef.current.delete(ticketId);
      
      // Mark on server with force=true
      const res = await fetch(`/api/operations/queue/${ticketId}/announce?force=true`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.warn(`[auto-voice] reannounce mark failed ${ticketId}:`, await res.text());
        throw new Error('فشل إعادة النداء');
      }

      console.log(`[auto-voice] reannounce marked ${ticketId}`);

      // Fetch this ticket's details and announce
      const dueRes = await fetch(`/api/operations/queue/due-announcements?date=${date}`);
      const data = await dueRes.json();

      const ticket = data.announcements?.find((a: Announcement) => a.queueTicketId === ticketId);
      if (ticket) {
        console.log(`[auto-voice] reannounce found ${ticket.ticketCode}, adding to queue`);
        queuedTicketIdsRef.current.add(ticketId);
        queueRef.current.push(ticket);
        processQueue();
        return true;
      } else {
        console.warn(`[auto-voice] reannounce ticket ${ticketId} not found in due-announcements`);
        return false;
      }
    } catch (err) {
      console.error(`[auto-voice] reannounce failed ${ticketId}:`, err);
      onError?.(err instanceof Error ? err.message : 'فشل إعادة النداء');
      return false;
    }
  }, [date, onError, processQueue]);

  // Stop all speech
  const stop = useCallback(() => {
    console.log('[auto-voice] stop called, clearing all');
    stopQueueSpeech();
    queueRef.current = [];
    isProcessingRef.current = false;
    setIsPlaying(false);
    // Clear tracking sets
    playingTicketIdsRef.current.clear();
    queuedTicketIdsRef.current.clear();
    // Keep announcedTicketIdsRef to prevent re-announcement
  }, []);

  return {
    isPlaying,
    lastAnnouncedId,
    reannounce,
    stop,
  };
}

// Check if voice is enabled in localStorage
export function isVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(VOICE_ENABLED_KEY) === 'true';
}

// Enable voice (call this after user interaction)
export function enableVoice(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    // Test speech synthesis availability
    if (!('speechSynthesis' in window)) {
      return false;
    }

    // Try to unlock audio context by speaking empty string
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);

    localStorage.setItem(VOICE_ENABLED_KEY, 'true');
    return true;
  } catch (e) {
    console.error('[voice] Enable failed:', e);
    return false;
  }
}

// Disable voice
export function disableVoice(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(VOICE_ENABLED_KEY);
  stopQueueSpeech();
}
