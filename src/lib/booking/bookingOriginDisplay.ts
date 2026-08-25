export type BookingOriginKind = 'website' | 'user' | 'system';

export type BookingOriginDisplay = {
  kind: BookingOriginKind;
  label: string;
};

/**
 * Who created a booking: public website vs a logged-in operations user.
 * Lead channels (phone/whatsapp) do not override a real CreatedByUserID.
 */
export function resolveBookingOriginLabel(input: {
  source?: string | null;
  createdByUserId?: number | string | null;
  createdByUserName?: string | null;
}): BookingOriginDisplay {
  const userIdRaw = input.createdByUserId;
  const userId =
    userIdRaw == null || userIdRaw === ''
      ? null
      : Number(userIdRaw);

  if (userId != null && Number.isFinite(userId) && userId > 0) {
    const name = String(input.createdByUserName ?? '').trim();
    return {
      kind: 'user',
      label: name || `مستخدم #${userId}`,
    };
  }

  const source = String(input.source ?? '').trim().toLowerCase();
  if (source === 'online' || userId === 0) {
    return { kind: 'website', label: 'الموقع' };
  }

  return { kind: 'system', label: 'السيستم' };
}
