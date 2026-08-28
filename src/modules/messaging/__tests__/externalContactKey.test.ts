import { describe, it, expect } from 'vitest';
import {
  extractJidFromRawPayload,
  resolveExternalContactKey,
} from '@/modules/messaging/conversation/domain/externalContactKey';

describe('externalContactKey', () => {
  it('prefers remote JID over display phone', () => {
    expect(
      resolveExternalContactKey({
        phone: '01000000000',
        rawPayload: JSON.stringify({ remoteJid: '201234567890@c.us' }),
      }),
    ).toBe('201234567890');
  });

  it('ignores group JIDs', () => {
    expect(extractJidFromRawPayload(JSON.stringify({ remoteJid: '120363@g.us' }))).toBeNull();
  });

  it('falls back to phone digits', () => {
    expect(
      resolveExternalContactKey({
        phone: '201 234 567 890',
        rawPayload: null,
      }),
    ).toBe('201234567890');
  });
});
