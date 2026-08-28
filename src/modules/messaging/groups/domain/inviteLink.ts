const CHAT_LINK_RE =
  /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/i;
const WEB_ACCEPT_RE =
  /^https:\/\/web\.whatsapp\.com\/accept\?code=[A-Za-z0-9_-]+$/i;

export function isValidWhatsAppGroupInviteLink(link: string): boolean {
  const trimmed = link.trim();
  return CHAT_LINK_RE.test(trimmed) || WEB_ACCEPT_RE.test(trimmed);
}

export function normalizeWhatsAppGroupInviteLink(link: string): string {
  return link.trim();
}
