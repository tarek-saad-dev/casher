import 'server-only';
import webpush from 'web-push';
import { schedulePostResponse } from '@/lib/schedulePostResponse';
import { maskClientFirstName } from '@/lib/employee-portal/bookingPrivacy';
import {
  deletePortalPushSubscriptionByEndpoint,
  listPortalPushSubscriptionsForEmployee,
} from '@/lib/employee-portal/pushSubscriptions';
import { getVapidConfig } from '@/lib/employee-portal/vapid';

export type StaffBookingPushInput = {
  assignedEmpId: number;
  tenantId?: string;
  bookingTime: string;
  customerName: string;
  services?: string[];
  branchName?: string;
  suppressNotification?: boolean;
};

export type StaffBookingPushResult =
  | { scheduled: false; reason: 'suppressed' | 'no_emp' | 'no_vapid' | 'no_subscriptions' | 'sent_inline' }
  | { scheduled: true };

function buildPayload(input: StaffBookingPushInput): { title: string; body: string; url: string } {
  const firstName = maskClientFirstName(input.customerName);
  const services = (input.services ?? []).filter(Boolean).slice(0, 3).join(' · ');
  const time = String(input.bookingTime || '').slice(0, 5);
  const bodyParts = [time && `الساعة ${time}`, firstName, services, input.branchName].filter(Boolean);
  return {
    title: 'حجز جديد لك',
    body: bodyParts.join(' · ') || 'تمت إضافة حجز جديد إلى جدولك',
    url: '/employee-portal/bookings',
  };
}

export async function sendStaffBookingPush(input: StaffBookingPushInput): Promise<StaffBookingPushResult> {
  if (input.suppressNotification) return { scheduled: false, reason: 'suppressed' };
  if (!Number.isSafeInteger(input.assignedEmpId) || input.assignedEmpId <= 0) {
    return { scheduled: false, reason: 'no_emp' };
  }

  const vapid = getVapidConfig();
  if (!vapid) return { scheduled: false, reason: 'no_vapid' };

  const subscriptions = await listPortalPushSubscriptionsForEmployee({
    empId: input.assignedEmpId,
    tenantId: input.tenantId,
  });
  if (subscriptions.length === 0) return { scheduled: false, reason: 'no_subscriptions' };

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify(buildPayload(input));

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.Endpoint,
            keys: { p256dh: sub.P256dh, auth: sub.Auth },
          },
          payload,
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : null;
        if (statusCode === 404 || statusCode === 410) {
          try {
            await deletePortalPushSubscriptionByEndpoint(sub.Endpoint);
          } catch {
            /* best-effort prune */
          }
          return;
        }
        console.error(
          '[staffBookingPush] send failed',
          statusCode,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );

  return { scheduled: false, reason: 'sent_inline' };
}

export function scheduleStaffBookingPush(input: StaffBookingPushInput): StaffBookingPushResult {
  if (input.suppressNotification) return { scheduled: false, reason: 'suppressed' };
  if (!Number.isSafeInteger(input.assignedEmpId) || input.assignedEmpId <= 0) {
    return { scheduled: false, reason: 'no_emp' };
  }
  if (!getVapidConfig()) return { scheduled: false, reason: 'no_vapid' };

  schedulePostResponse(async () => {
    await sendStaffBookingPush(input);
  });
  return { scheduled: true };
}
