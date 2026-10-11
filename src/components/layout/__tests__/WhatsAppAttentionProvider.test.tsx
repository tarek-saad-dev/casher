// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WhatsAppAttentionProvider from '@/components/layout/WhatsAppAttentionProvider';

let pathname = '/income/pos';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const UNREAD = {
  items: [
    { conversationId: 1, displayName: 'Client', phone: '201000000000', lastMessagePreview: 'hi', lastMessageAt: '2026-10-10T10:00:00Z', unreadCount: 1 },
  ],
};

function mockInbox(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const launcher = () => screen.queryByRole('link', { name: /محادثات واتساب محتاجة رد/ });

describe('WhatsAppAttentionProvider', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    pathname = '/income/pos';
  });

  it('shows the launcher when the tenant has Messaging and unread chats', async () => {
    mockInbox(200, UNREAD);
    render(<WhatsAppAttentionProvider><div /></WhatsAppAttentionProvider>);
    await waitFor(() => expect(launcher()).toBeInTheDocument());
  });

  it('hides the launcher and stops polling when Messaging is not installed', async () => {
    vi.useFakeTimers();
    const fetchMock = mockInbox(403, { code: 'APP_NOT_INSTALLED', reason: 'messaging' });
    render(<WhatsAppAttentionProvider><div /></WhatsAppAttentionProvider>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(launcher()).not.toBeInTheDocument();
  });

  it('keeps polling after a permission 403 that is not about Messaging', async () => {
    vi.useFakeTimers();
    const fetchMock = mockInbox(403, { error: 'forbidden' });
    render(<WhatsAppAttentionProvider><div /></WhatsAppAttentionProvider>);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not poll the tenant inbox on the platform console', async () => {
    pathname = '/platform/tenants/new';
    const fetchMock = mockInbox(200, UNREAD);
    render(<WhatsAppAttentionProvider><div /></WhatsAppAttentionProvider>);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(launcher()).not.toBeInTheDocument();
  });
});
