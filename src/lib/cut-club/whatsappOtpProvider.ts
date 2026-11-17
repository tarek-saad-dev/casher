/**
 * CUT CLUB — tenant-owned WhatsApp OTP delivery via the Casher messaging app.
 *
 * This adapter is only a TRANSPORT, never proof of customer identity.
 * requestCutClubOtp MUST first reserve the challenge in the durable
 * rate-limited SQL repository. Verification MUST consume it exactly once,
 * check the original phone HMAC and bind to one tenant-owned active customer.
 *
 * OFF by default, no sends on import, no phone/code logging, no public route.
 */
import "server-only";
import type { OtpDeliveryProvider } from "./otpDomain";
import { sendMessage } from "@/modules/messaging";
import { runWithMessagingTenant } from "@/modules/messaging/tenancy/messagingTenantScope";

const uuid = (x: unknown): x is string => typeof x === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(x);
const e164 = (x: unknown): x is string =>
  typeof x === "string" && /^\+[1-9]\d{7,14}$/.test(x);
const challenge = (x: unknown): x is string =>
  typeof x === "string" && /^[A-Za-z0-9_-]{32}$/.test(x);
const otp = (x: unknown): x is string =>
  typeof x === "string" && /^\d{6}$/.test(x);

/**
 * The number is never serialized into metadata or logs, and the challenge
 * identifier must NOT appear in outbound message or analytics.
 */
function smsStyleWhatsAppText(code: string): string {
  return `رمز تأكيد CUT CLUB: ${code}\nصالح لمدة ٥ دقائق. لا تشارك الرمز مع أي شخص.\nلو مش أنت اللي طلبته، تجاهل الرسالة.`;
}

/**
 * Trusted tenant comes from a separately validated server-side salon/branch
 * ownership lookup. NEVER from request JSON, a user-selected tenantId, phone
 * number, a query clientId or a browser cookie.
 *
 * Double release gate: explicit operator approval PLUS dedicated env flag.
 * The active channel is independently resolved by Casher messaging tenancy.
 */
export function createCutClubWhatsAppOtpProvider(options: Readonly<{
  trustedTenantId: string;
  operatorApproved: boolean;
}>): OtpDeliveryProvider {
  return {
    async sendCode(input) {
      if (options.operatorApproved !== true ||
          process.env.CUT_CLUB_WHATSAPP_OTP_DELIVERY_ENABLED !== "true" ||
          !uuid(options.trustedTenantId) ||
          input.tenantId !== options.trustedTenantId ||
          !e164(input.phoneE164) ||
          !otp(input.codeForDelivery) ||
          !challenge(input.challengeId)) return "failed";
      try {
        const response = await runWithMessagingTenant({
          tenantId: options.trustedTenantId,
          source: "branch",
          detail: "cut-club-auth-whatsapp-otp",
        }, () => sendMessage({
          channel: "whatsapp",
          recipient: { phone: input.phoneE164 },
          content: { text: smsStyleWhatsAppText(input.codeForDelivery) },
          metadata: { source: "cut_club.customer_verification" },
        }));
        return response.sent === true && response.skipped !== true ? "sent" : "failed";
      } catch {
        // Provider errors are never logged with customer phone/code/message.
        return "failed";
      }
    },
  };
}
