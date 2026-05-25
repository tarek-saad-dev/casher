"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { stopQueueSpeech } from "@/lib/queueVoice";
import { speakWithAzure } from "@/lib/queueVoice";
import type { AnnouncementPart } from "@/lib/chairMapping";
import { musicController } from "@/components/operations/OperationsMusicPlayer";

interface Announcement {
  type: "queue_ticket" | "booking";
  // queue ticket fields
  queueTicketId?: number;
  // booking fields
  bookingId?: number;
  // common
  ticketCode: string;
  customerName: string | null;
  customerMobile: string | null;
  empId: number;
  empName: string | null;
  chairNumber: number | null;
  chairDisplayText: string;
  estimatedStartTime?: string;
  scheduledTime?: string;
  announcementText: string;
  announcementTextAr: string;
  announcementTextEn: string;
  announcementSequence: AnnouncementPart[];
}

/** Unique key per announcement — prevents cross-type collisions */
function announcementKey(a: Announcement): string {
  return a.type === "booking"
    ? `booking-${a.bookingId}`
    : `queue-${a.queueTicketId}`;
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
const VOICE_ENABLED_KEY = "operationsVoiceEnabled";

export function useAutoVoiceAnnounce(options: UseAutoVoiceAnnounceOptions) {
  const {
    date,
    enabled,
    pollIntervalMs = 10000,
    onAnnouncementStart,
    onAnnouncementEnd,
    onError,
  } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [lastAnnouncedId, setLastAnnouncedId] = useState<number | null>(null);

  // Three tracking sets to prevent duplicate announcements (keyed by announcementKey)
  const playingTicketIdsRef = useRef<Set<string>>(new Set()); // Currently playing
  const announcedTicketIdsRef = useRef<Set<string>>(new Set()); // Already announced (persisted)
  const queuedTicketIdsRef = useRef<Set<string>>(new Set()); // In queue waiting

  // Polling control refs
  const isProcessingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<Announcement[]>([]);
  const pollingStartedRef = useRef(false);

  // Clear announced IDs when date changes
  useEffect(() => {
    console.log("[auto-voice] date changed, clearing tracking sets");
    announcedTicketIdsRef.current.clear();
    playingTicketIdsRef.current.clear();
    queuedTicketIdsRef.current.clear();
    queueRef.current = [];
    setLastAnnouncedId(null);
  }, [date]);

  // Helper to play announcement sequence
  const playAnnouncementSequence = useCallback(
    async (
      sequence: AnnouncementPart[],
      ticketId: number,
      ticketCode: string,
    ): Promise<void> => {
      console.log(
        `[auto-voice] play start ${ticketCode} (${ticketId}) - ${sequence.length} parts`,
      );

      for (let i = 0; i < sequence.length; i++) {
        const part = sequence[i];
        console.log(
          `[auto-voice] playing part ${i + 1}/${sequence.length} for ${ticketCode} (${part.lang})`,
        );

        try {
          // Play each part with appropriate voice using Azure only
          await speakWithAzure(part.text, {
            voiceName:
              part.lang === "ar-EG" ? "ar-EG-SalmaNeural" : "en-US-JennyNeural",
            locale: part.lang,
            rate: part.rate,
            pitch: part.pitch,
          });
          console.log(`[auto-voice] part ${i + 1} completed for ${ticketCode}`);
        } catch (err) {
          console.error(
            `[auto-voice] Azure failed for ${ticketCode} part ${i + 1}:`,
            err,
          );
          // Don't fallback to browser - just throw the error
          throw err;
        }

        // Small pause between parts (except after last)
        if (i < sequence.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      console.log(`[auto-voice] play end ${ticketCode} (${ticketId})`);
    },
    [],
  );

  // Process announcement queue
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;

    isProcessingRef.current = true;
    setIsPlaying(true);

    const announcement = queueRef.current.shift()!;
    const key = announcementKey(announcement);
    const numericId =
      announcement.type === "booking"
        ? announcement.bookingId!
        : announcement.queueTicketId!;
    const ticketCode = announcement.ticketCode;

    // Mark as playing and remove from queued
    playingTicketIdsRef.current.add(key);
    queuedTicketIdsRef.current.delete(key);

    console.log(`[auto-voice] processing start ${ticketCode} (${key})`);

    try {
      onAnnouncementStart?.(announcement);

      await musicController.duckVolume(15, 400);

      if (
        announcement.announcementSequence &&
        announcement.announcementSequence.length > 0
      ) {
        await playAnnouncementSequence(
          announcement.announcementSequence,
          numericId,
          ticketCode,
        );
      } else {
        await speakWithAzure(announcement.announcementText || `${ticketCode}`, {
          voiceName: "ar-EG-SalmaNeural",
          locale: "ar-EG",
          rate: "-5%",
        });
      }

      // Mark as announced on server via unified endpoint
      console.log(`[auto-voice] mark announced ${ticketCode} (${key})`);
      const res = await fetch("/api/operations/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: announcement.type,
          id: numericId,
        }),
      });

      if (!res.ok) {
        console.warn(
          `[auto-voice] mark failed ${ticketCode}:`,
          await res.text(),
        );
      } else {
        console.log(`[auto-voice] mark success ${ticketCode}`);
      }

      // Move from playing to announced
      playingTicketIdsRef.current.delete(key);
      announcedTicketIdsRef.current.add(key);
      setLastAnnouncedId(numericId);

      onAnnouncementEnd?.(announcement);
    } catch (err) {
      console.error(`[auto-voice] announcement failed ${ticketCode}:`, err);
      onError?.(err instanceof Error ? err.message : "فشل تشغيل النداء");
      // Still mark as announced locally to prevent infinite retry loop
      playingTicketIdsRef.current.delete(key);
      announcedTicketIdsRef.current.add(key);
    } finally {
      await musicController.restoreVolume(700);

      playingTicketIdsRef.current.delete(key);
      isProcessingRef.current = false;
      setIsPlaying(false);

      console.log(`[auto-voice] processing end ${ticketCode}`);

      if (queueRef.current.length > 0) {
        setTimeout(() => processQueue(), 500);
      }
    }
  }, [
    onAnnouncementStart,
    onAnnouncementEnd,
    onError,
    playAnnouncementSequence,
  ]);

  // Fetch due announcements
  const fetchAnnouncements = useCallback(async () => {
    if (!enabled) {
      console.log("[auto-voice] fetch skipped - not enabled");
      return;
    }

    // Skip if currently processing to avoid race conditions
    if (isProcessingRef.current) {
      console.log("[auto-voice] fetch skipped - processing in progress");
      return;
    }

    try {
      console.log(`[auto-voice] fetching announcements for ${date}`);
      const res = await fetch(
        `/api/operations/queue/due-announcements?date=${date}`,
      );
      if (!res.ok) throw new Error("فشل جلب النداءات");

      const data = await res.json();
      if (!data.ok || !data.announcements) {
        console.log("[auto-voice] no announcements in response");
        return;
      }

      console.log(
        `[auto-voice] fetched ${data.announcements.length} announcements:`,
        data.announcements.map((a: Announcement) => a.ticketCode).join(", "),
      );

      // Filter out already tracked announcements (playing, announced, or queued)
      const newAnnouncements = data.announcements.filter((a: Announcement) => {
        const key = announcementKey(a);
        if (playingTicketIdsRef.current.has(key)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=playing`);
          return false;
        }
        if (queuedTicketIdsRef.current.has(key)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=queued`);
          return false;
        }
        if (announcedTicketIdsRef.current.has(key)) {
          console.log(`[auto-voice] skip ${a.ticketCode} - reason=announced`);
          return false;
        }
        return true;
      });

      console.log(
        `[auto-voice] ${newAnnouncements.length} new announcements after filtering`,
      );

      if (newAnnouncements.length > 0) {
        newAnnouncements.forEach((a: Announcement) => {
          const key = announcementKey(a);
          console.log(`[auto-voice] queue ${a.ticketCode} (${key})`);
          queuedTicketIdsRef.current.add(key);
          queueRef.current.push(a);
        });
        processQueue();
      }
    } catch (err) {
      console.error("[auto-voice] fetch error:", err);
    }
  }, [date, enabled, processQueue]);

  // Start polling when enabled - with React Strict Mode protection
  useEffect(() => {
    if (!enabled) {
      if (pollTimerRef.current) {
        console.log("[auto-voice] polling interval cleared (disabled)");
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollingStartedRef.current = false;
      return;
    }

    // Prevent double interval creation (React Strict Mode)
    if (pollingStartedRef.current) {
      console.log("[auto-voice] polling already started, skipping");
      return;
    }

    console.log("[auto-voice] polling interval created");
    pollingStartedRef.current = true;

    // Initial fetch
    fetchAnnouncements();

    // Start polling
    pollTimerRef.current = setInterval(fetchAnnouncements, pollIntervalMs);

    return () => {
      console.log("[auto-voice] polling interval cleanup");
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollingStartedRef.current = false;
    };
  }, [enabled, pollIntervalMs, fetchAnnouncements]);

  // Manual re-announce (queue tickets only — called from BarberLane)
  const reannounce = useCallback(
    async (ticketId: number) => {
      try {
        console.log(`[auto-voice] reannounce request queue-${ticketId}`);
        const key = `queue-${ticketId}`;

        announcedTicketIdsRef.current.delete(key);
        playingTicketIdsRef.current.delete(key);
        queuedTicketIdsRef.current.delete(key);

        // Force-reset on server
        const res = await fetch("/api/operations/announce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "queue_ticket",
            id: ticketId,
            force: true,
          }),
        });

        if (!res.ok) {
          throw new Error("فشل إعادة النداء");
        }

        // Re-fetch due announcements to get the sequence
        const dueRes = await fetch(
          `/api/operations/queue/due-announcements?date=${date}`,
        );
        const data = await dueRes.json();

        const ticket = data.announcements?.find(
          (a: Announcement) =>
            a.type === "queue_ticket" && a.queueTicketId === ticketId,
        );
        if (ticket) {
          queuedTicketIdsRef.current.add(key);
          queueRef.current.push(ticket);
          processQueue();
          return true;
        }
        return false;
      } catch (err) {
        console.error(`[auto-voice] reannounce failed:`, err);
        onError?.(err instanceof Error ? err.message : "فشل إعادة النداء");
        return false;
      }
    },
    [date, onError, processQueue],
  );

  // Stop all speech
  const stop = useCallback(() => {
    console.log("[auto-voice] stop called, clearing all");
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
  if (typeof window === "undefined") return false;
  return localStorage.getItem(VOICE_ENABLED_KEY) === "true";
}

// Enable voice (call this after user interaction)
export function enableVoice(): boolean {
  if (typeof window === "undefined") return false;

  try {
    // Test speech synthesis availability
    if (!("speechSynthesis" in window)) {
      return false;
    }

    // Try to unlock audio context by speaking empty string
    const utterance = new SpeechSynthesisUtterance("");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);

    localStorage.setItem(VOICE_ENABLED_KEY, "true");
    return true;
  } catch (e) {
    console.error("[voice] Enable failed:", e);
    return false;
  }
}

// Disable voice
export function disableVoice(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(VOICE_ENABLED_KEY);
  stopQueueSpeech();
}
