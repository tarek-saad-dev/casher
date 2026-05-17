/**
 * queueVoice.ts — Arabic voice announcement utility for queue system.
 * Primary provider : Azure Speech TTS (server-side proxy at /api/queue/voice)
 * Fallback provider: browser Web Speech API
 * IMPORTANT: Never access window/speechSynthesis on the server.
 */

export type VoiceProvider = 'azure' | 'browser';

export interface QueueVoiceOptions {
  provider?:   VoiceProvider;
  voiceName?:  string;
  locale?:     string;
  rate?:       string;
  pitch?:      string;
}

/** Accepts PascalCase and camelCase field names from any ticket object. */
export interface QueueTicketVoiceInfo {
  ticketCode?:   string | null;
  TicketCode?:   string | null;
  clientName?:   string | null;
  ClientName?:   string | null;
  CustomerName?: string | null;
  customerName?: string | null;
  empName?:      string | null;
  EmpName?:      string | null;
  BarberName?:   string | null;
  barberName?:   string | null;
}

// ── Field normalisation ────────────────────────────────────────────────────────

function resolveFields(ticket: QueueTicketVoiceInfo) {
  const code =
    (ticket.TicketCode   ?? ticket.ticketCode ?? '').trim();

  const client =
    (ticket.CustomerName ?? ticket.customerName ??
     ticket.ClientName   ?? ticket.clientName   ?? '').trim() || null;

  const barber =
    (ticket.BarberName   ?? ticket.barberName ??
     ticket.EmpName      ?? ticket.empName    ?? '').trim() || null;

  return { code, client, barber };
}

// ── Announcement text ─────────────────────────────────────────────────────────

export function buildQueueAnnouncement(ticket: QueueTicketVoiceInfo): string {
  const { code, client, barber } = resolveFields(ticket);

  if (client && barber) return `عميلنا ${client}، يتفضل يتوجه إلى الأستاذ ${barber}.`;
  if (client)           return `عميلنا ${client}، يتفضل يتوجه إلى منطقة الخدمة.`;
  if (code && barber)   return `صاحب الدور رقم ${code}، يتفضل يتوجه إلى الأستاذ ${barber}.`;
  if (code)             return `صاحب الدور رقم ${code}، يتفضل يتوجه إلى منطقة الخدمة.`;
  return 'عميلنا الكريم، يتفضل يتوجه إلى منطقة الخدمة.';
}

// ── Azure TTS (via server proxy) ──────────────────────────────────────────────

export async function speakWithAzure(
  text: string,
  options: Omit<QueueVoiceOptions, 'provider'> = {},
): Promise<void> {
  console.log('[voice] Azure request start');
  console.log('[voice] announcement text:', text);

  const res = await fetch('/api/queue/voice', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceName: options.voiceName ?? 'ar-EG-SalmaNeural',
      locale:    options.locale    ?? 'ar-EG',
      rate:      options.rate      ?? '-5%',
      pitch:     options.pitch     ?? '0%',
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    console.error('[voice] Azure response error:', res.status, data);
    throw new Error(data.error ?? 'AZURE_ERROR');
  }

  console.log('[voice] Azure audio received');

  const blob     = await res.blob();
  const audioUrl = URL.createObjectURL(blob);
  const audio    = new Audio(audioUrl);

  return new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      console.log('[voice] audio play ended');
      URL.revokeObjectURL(audioUrl);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl);
      console.error('[voice] audio play error', e);
      reject(new Error('AUDIO_PLAY_ERROR'));
    };
    audio.play()
      .then(() => console.log('[voice] audio play started'))
      .catch((e) => { URL.revokeObjectURL(audioUrl); reject(e); });
  });
}

// ── Browser Speech API fallback ────────────────────────────────────────────────

function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) { resolve(voices); return; }
    let done = false;
    window.speechSynthesis.onvoiceschanged = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };
    setTimeout(() => {
      if (done) return;
      done = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    }, 500);
  });
}

function pickArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find(v => v.lang === 'ar-EG') ??
    voices.find(v => v.lang === 'ar-SA') ??
    voices.find(v => v.lang.startsWith('ar')) ??
    null
  );
}

export async function speakWithBrowser(text: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('speechSynthesis' in window)) throw new Error('NO_SPEECH_SYNTHESIS');

  console.log('[voice] fallback to browser');
  window.speechSynthesis.cancel();

  const voices = await loadBrowserVoices();
  const voice  = pickArabicVoice(voices);
  if (!voice) console.warn('[voice] no Arabic voice found, using browser default');

  const utterance  = new SpeechSynthesisUtterance(text);
  utterance.lang   = 'ar-EG';
  utterance.rate   = 0.9;
  utterance.pitch  = 1;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;

  return new Promise<void>((resolve, reject) => {
    utterance.onend   = () => { console.log('[voice] browser done'); resolve(); };
    utterance.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') { resolve(); return; }
      reject(new Error(e.error ?? 'SPEECH_ERROR'));
    };
    // Defer by 50ms — Chrome drops speak() in same frame as cancel()
    setTimeout(() => window.speechSynthesis.speak(utterance), 50);
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Speak a queue announcement.
 * Tries Azure first; falls back to browser SpeechSynthesis on failure.
 * Throws 'BOTH_FAILED' if both providers fail.
 */
export async function speakQueueTicket(
  ticket: QueueTicketVoiceInfo,
  options: QueueVoiceOptions = {},
): Promise<void> {
  const text     = buildQueueAnnouncement(ticket);
  const provider = options.provider ?? 'azure';

  console.log('[voice] provider:', provider);
  console.log('[voice] announcement text:', text);

  if (provider === 'azure') {
    try {
      await speakWithAzure(text, options);
      return;
    } catch (azureErr) {
      console.warn('[voice] Azure failed, trying browser fallback:', azureErr);
    }
    // Azure failed — try browser
    try {
      await speakWithBrowser(text);
      return;
    } catch (browserErr) {
      console.error('[voice] browser fallback also failed:', browserErr);
      throw new Error('BOTH_FAILED');
    }
  }

  // provider === 'browser'
  await speakWithBrowser(text);
}

// ── Stop ──────────────────────────────────────────────────────────────────────

export function stopQueueSpeech(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/** Synchronous Arabic voice picker — for quick checks. */
export function getArabicVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  return pickArabicVoice(window.speechSynthesis.getVoices());
}
