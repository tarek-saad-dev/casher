import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST, OPTIONS } from "@/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route";

describe("CUT CLUB legacy reward redemption quarantine (#270)", () => {
  it.each([
    ["POST", POST],
    ["OPTIONS", OPTIONS],
  ])("%s fails closed with no account disclosure or browser CORS grant", async (_, handler) => {
    const response = await handler();
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(await response.json()).toEqual({
      ok: false,
      error: "CUT CLUB reward redemption requires verified customer sign-in",
    });
  });

  it("ignores caller-selected clientId, rewardId, body, fake credentials and staff cookies", async () => {
    const urls = [
      "https://example.invalid/api/public/client/loyalty/rewards/1/redeem?clientId=1",
      "https://example.invalid/api/public/client/loyalty/rewards/99999/redeem?clientId=99999",
      "https://example.invalid/api/public/client/loyalty/rewards/nope/redeem",
    ];
    for (const url of urls) {
      const request = new Request(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer fake",
          Cookie: "pos_session=fake",
          Origin: "https://example.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirm: true, clientId: 123 }),
      });
      // Next.js may pass arguments to zero-arity route handlers at runtime;
      // they must be ignored, with no parsing or database side effects.
      const response = await Reflect.apply(POST, undefined, [
        request,
        { params: Promise.resolve({ rewardId: "1" }) },
      ]);
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("does not invoke DB/ledger/reward services and cannot be reenabled via flags", async () => {
    const path = "src/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route.ts";
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    expect(source).not.toContain('from "@/lib/db"');
    expect(source).not.toContain("getPool(");
    expect(source).not.toContain("sql.Transaction");
    expect(source).not.toContain("generateRewardRedeemCode");
    expect(source).not.toContain("clientIdParam");
    expect(source).not.toMatch(/Access-Control-Allow-Origin/);
    const previous = process.env.CUT_CLUB_LEGACY_REDEEM_ENABLED;
    try {
      process.env.CUT_CLUB_LEGACY_REDEEM_ENABLED = "true";
      expect((await POST()).status).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.CUT_CLUB_LEGACY_REDEEM_ENABLED;
      else process.env.CUT_CLUB_LEGACY_REDEEM_ENABLED = previous;
    }
  });
});
