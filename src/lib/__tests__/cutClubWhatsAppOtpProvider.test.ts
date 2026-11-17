import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  runWithMessagingTenant: vi.fn(async (
    _scope: unknown, work: () => Promise<unknown>,
  ) => work()),
}));
vi.mock("@/modules/messaging", () => ({ sendMessage: fake.sendMessage }));
vi.mock("@/modules/messaging/tenancy/messagingTenantScope", () => ({
  runWithMessagingTenant: fake.runWithMessagingTenant,
}));

import { createCutClubWhatsAppOtpProvider } from "@/lib/cut-club/whatsappOtpProvider";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const outbound = {
  tenantId, phoneE164: "+201012345678",
  challengeId: "a".repeat(32), codeForDelivery: "123456",
};
const key = "CUT_CLUB_WHATSAPP_OTP_DELIVERY_ENABLED";
const previous = process.env[key];

beforeEach(() => {
  fake.sendMessage.mockReset().mockResolvedValue({ sent: true, skipped: false, messageId: "fake" });
  fake.runWithMessagingTenant.mockClear();
  delete process.env[key];
});
afterEach(() => {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
});

describe("CUT CLUB deferred WhatsApp OTP transport", () => {
  it("is OFF unless both release controls approve; never sends on import", async () => {
    const provider = createCutClubWhatsAppOtpProvider({ trustedTenantId: tenantId, operatorApproved: true });
    expect(await provider.sendCode(outbound)).toBe("failed");
    expect(fake.sendMessage).not.toHaveBeenCalled();
    process.env[key] = "true";
    const blocked = createCutClubWhatsAppOtpProvider({ trustedTenantId: tenantId, operatorApproved: false });
    expect(await blocked.sendCode(outbound)).toBe("failed");
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects wrong tenant/number/OTP/challenge without any provider send", async () => {
    process.env[key] = "true";
    const provider = createCutClubWhatsAppOtpProvider({ trustedTenantId: tenantId, operatorApproved: true });
    for (const invalid of [
      { tenantId: otherTenant },
      { phoneE164: "01012345678" },
      { phoneE164: "+123" },
      { codeForDelivery: "12345" },
      { codeForDelivery: "1234567" },
      { codeForDelivery: "abcdef" },
      { challengeId: "wrong" },
    ]) expect(await provider.sendCode({ ...outbound, ...invalid })).toBe("failed");
    expect(fake.sendMessage).not.toHaveBeenCalled();
    expect(fake.runWithMessagingTenant).not.toHaveBeenCalled();
  });

  it("uses exactly the caller's trusted tenant channel, sends only a 5-minute code", async () => {
    process.env[key] = "true";
    const provider = createCutClubWhatsAppOtpProvider({ trustedTenantId: tenantId, operatorApproved: true });
    expect(await provider.sendCode(outbound)).toBe("sent");
    expect(fake.runWithMessagingTenant).toHaveBeenCalledTimes(1);
    expect(fake.runWithMessagingTenant.mock.calls[0][0]).toMatchObject({
      tenantId, source: "branch", detail: "cut-club-auth-whatsapp-otp",
    });
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    const request = fake.sendMessage.mock.calls[0][0];
    expect(request.channel).toBe("whatsapp");
    expect(request.recipient.phone).toBe(outbound.phoneE164);
    expect(request.content.text).toContain("123456");
    expect(request.content.text).toContain("٥ دقائق");
    expect(request.metadata).toEqual({ source: "cut_club.customer_verification" });
    expect(JSON.stringify(request)).not.toContain(outbound.challengeId);
    expect(JSON.stringify(request.metadata)).not.toContain(outbound.phoneE164);
    expect(JSON.stringify(request.metadata)).not.toContain(outbound.codeForDelivery);
  });

  it("does not claim delivered if tenant channel is missing, provider skips, or transport errors", async () => {
    process.env[key] = "true";
    const provider = createCutClubWhatsAppOtpProvider({ trustedTenantId: tenantId, operatorApproved: true });
    for (const outcome of [
      { sent: false, skipped: true, reason: "channel_not_configured" },
      { sent: false, skipped: false, reason: "connection_failed" },
      { sent: true, skipped: true },
    ]) {
      fake.sendMessage.mockResolvedValueOnce(outcome);
      expect(await provider.sendCode(outbound)).toBe("failed");
    }
    fake.sendMessage.mockRejectedValueOnce(new Error("provider offline"));
    expect(await provider.sendCode(outbound)).toBe("failed");
  });
});
