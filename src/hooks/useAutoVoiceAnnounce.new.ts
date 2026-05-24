'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { stopQueueSpeech } from '@/lib/queueVoice';
import { speakWithAzure } from '@/lib/queueVoice';
import type { AnnouncementPart } from '@/lib/chairMapping';

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

// Helper to play announcement sequence
async function playAnnouncementSequence(
  sequence: AnnouncementPart[],
  onPartStart?: (index: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < sequence.length; i++) {
    const part = sequence[i];
    onPartStart?.(i + 1, sequence.length);

    // Wait for each part to complete before playing next
    await speakWithAzure(part.text, {
      voiceName: part.lang === 'ar-EG' ? 'ar-EG-SalmaNeural' : 'en-US-JennyNeural',
      locale: part.lang,
      rate: part.rate,
      pitch: part.pitch,
    });

    // Small pause between parts
    if (i < sequence.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export function useAutoVoiceAnnounce(options: UseAutoVoiceAnnounceOptions) {
  const { date, enabled, pollIntervalMs = 10000, onAnnouncementStart, onAnnouncementEnd, onError } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [lastAnnouncedId, setLastAnnouncedId] = useState<number | null>(null);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const announcedIdsRef = useRef<Set<number>>(new Set());
  const isProcessingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<Announcement[]>([]);

  // Clear announced IDs when date changes
  useEffect(() => {
    announcedIdsRef.current.clear();
    setLastAnnouncedId(null);
  }, [date]);

  // Process announcement queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;

    isProcessingRef.current = true;
    setIsPlaying(true);

    const announcement = queueRef.current.shift()!;

    try {
      onAnnouncementStart?.(announcement);

      // Play announcement sequence (Arabic x2, English x1)
      if (announcement.announcementSequence && announcement.announcementSequence.length > 0) {
        setTotalParts(announcement.announcementSequence.length);

        await playAnnouncementSequence(
          announcement.announcementSequence,
          (partIndex, total) => {
            setCurrentPartIndex(partIndex);
            console.log(`[auto-voice] Playing part ${partIndex}/${total}: ${announcement.ticketCode}`);
          }
        );
      } else {
        // Fallback to legacy single announcement
        await speakWithAzure(announcement.announcementText || `دور ${announcement.ticketCode}`, {
          voiceName: 'ar-EG-SalmaNeural',
          locale: 'ar-EG',
          rate: '-5%',
        });
      }

      // Mark as announced on server AFTER voice completes
      const res = await fetch(`/api/operations/queue/${announcement.queueTicketId}/announce`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.warn('[auto-voice] Failed to mark announcement:', await res.text());
      }

      // Add to announced set
      announcedIdsRef.current.add(announcement.queueTicketId);
      setLastAnnouncedId(announcement.queueTicketId);

      onAnnouncementEnd?.(announcement);
    } catch (err) {
      console.error('[auto-voice] Announcement failed:', err);
      onError?.(err instanceof Error ? err.message : 'فشل تشغيل النداء');
    } finally {
      isProcessingRef.current = false;
      setIsPlaying(false);
      setCurrentPartIndex(0);
      setTotalParts(0);

      // Process next in queue if any
      if (queueRef.current.length > 0) {
        setTimeout(() => processQueue(), 500);
      }
    }
  }, [onAnnouncementStart, onAnnouncementEnd, onError]);

  // Fetch due announcements
  const fetchAnnouncements = useCallback(async () => {
    if (!enabled || isProcessingRef.current) return;

    try {
      const res = await fetch(`/api/operations/queue/due-announcements?date=${date}`);
      if (!res.ok) throw new Error('فشل جلب النداءات');

      const data = await res.json();
      if (!data.ok || !data.announcements) return;

      // Filter out already announced tickets
      const newAnnouncements = data.announcements.filter(
        (a: Announcement) => !announcedIdsRef.current.has(a.queueTicketId)
      );

      if (newAnnouncements.length > 0) {
        // Add to queue
        queueRef.current.push(...newAnnouncements);
        // Start processing if not already
        processQueue();
      }
    } catch (err) {
      console.error('[auto-voice] Fetch error:', err);
    }
  }, [date, enabled, processQueue]);

  // Start polling when enabled
  useEffect(() => {
    if (!enabled) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchAnnouncements();

    // Start polling
    pollTimerRef.current = setInterval(fetchAnnouncements, pollIntervalMs);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [enabled, pollIntervalMs, fetchAnnouncements]);

  // Manual re-announce function
  const reannounce = useCallback(async (ticketId: number) => {
    try {
      // Remove from announced set first
      announcedIdsRef.current.delete(ticketId);

      // Fetch this ticket's details
      const dueRes = await fetch(`/api/operations/queue/due-announcements?date=${date}`);
      const data = await dueRes.json();

      const ticket = data.announcements?.find((a: Announcement) => a.queueTicketId === ticketId);
      if (ticket) {
        // Mark as announced with force=true (resets server state)
        const announceRes = await fetch(`/api/operations/queue/${ticketId}/announce?force=true`, {
          method: 'POST',
        });

        if (!announceRes.ok) throw new Error('فشل إعادة النداء');

        // Remove from announced set to allow re-announcement
        announcedIdsRef.current.delete(ticketId);

        // Add to queue and process
        queueRef.current.push(ticket);
        processQueue();

        return true;
      }

      return false;
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'فشل إعادة النداء');
      return false;
    }
  }, [date, onError, processQueue]);

  // Stop all speech
  const stop = useCallback(() => {
    stopQueueSpeech();
    queueRef.current = [];
    isProcessingRef.current = false;
    setIsPlaying(false);
    setCurrentPartIndex(0);
    setTotalParts(0);
  }, []);

  return {
    isPlaying,
    currentPartIndex,
    totalParts,
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
