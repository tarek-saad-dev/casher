import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GET as loyaltyMe, OPTIONS as loyaltyMePreflight } from "@/app/api/public/client/loyalty/me/route";
import { GET as activity, OPTIONS as activityPreflight } from "@/app/api/public/client/loyalty/activity/route";
import { GET as rewards, OPTIONS as rewardsPreflight } from "@/app/api/public/client/loyalty/rewards/route";
import { GET as inventory, OPTIONS as inventoryPreflight } from "@/app/api/public/client/inventory/route";
import { GET as inventoryDetails, OPTIONS as inventoryDetailsPreflight } from "@/app/api/public/client/inventory/[inventoryId]/route";
import { GET as referral, OPTIONS as referralPreflight } from "@/app/api/public/client/referral/route";
import { GET as store, OPTIONS as storePreflight } from "@/app/api/public/client/store/route";
import { GET as storeItem, OPTIONS as storeItemPreflight } from "@/app/api/public/client/store/items/[itemId]/route";
import { LEGACY_MEMBER_READS_QUARANTINED, rejectLegacyMemberRead } from "@/lib/cut-club/legacyMemberReadQuarantine";

const routes = [
  ["loyalty/me", loyaltyMe, loyaltyMePreflight],
  ["loyalty/activity", activity, activityPreflight],
  ["loyalty/rewards", rewards, rewardsPreflight],
  ["inventory", inventory, inventoryPreflight],
  ["inventory/[inventoryId]", inventoryDetails, inventoryDetailsPreflight],
  ["referral", referral, referralPreflight],
  ["store", store, storePreflight],
  ["store/items/[itemId]", storeItem, storeItemPreflight],
] as const;

describe("CUT CLUB private legacy GET quarantine (#274)", () => {
  it("is unconditionally enabled: old member GETs have no legacy feature flag", () => {
    expect(LEGACY_MEMBER_READS_QUARANTINED).toBe(true);
  });

  for (const [path, get, options] of routes) {
    it(`${path} GET and OPTIONS deny anonymous / synthetic client credentials`, async () => {
      for (const fn of [get, options]) {
        const response = await fn();
        expect(response.status).toBe(403);
        expect(response.headers.get("Cache-Control")).toContain("private");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect(await response.json()).toEqual({
          ok: false,
          error: "Verified CUT CLUB customer sign-in required",
        });
      }
      const request = new Request(`https://example.invalid/api/public/client/${path}?clientId=9999`, {
        headers: {
          Authorization: "Bearer fake",
          Cookie: "pos_session=fake",
          Origin: "https://not-your-site.invalid",
        },
      });
      const response = await Reflect.apply(get, undefined, [
        request,
        { params: Promise.resolve({ inventoryId: "1", itemId: "2" }) },
      ]);
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  }

  it("ignores legacy environment re-enable switches", async () => {
    const key = "CUT_CLUB_ALLOW_LEGACY_PRIVATE_GET";
    const saved = process.env[key];
    try {
      process.env[key] = "true";
      expect((await rejectLegacyMemberRead()).status).toBe(403);
      expect((await loyaltyMe()).status).toBe(403);
      expect((await storeItem()).status).toBe(403);
    } finally {
      if (saved === undefined) delete process.env[key];
      else process.env[key] = saved;
    }
  });

  it("cannot import DB/ledger/store/identity services from eight quarantined routes", () => {
    for (const [path] of routes) {
      const src = readFileSync(
        resolve(process.cwd(), `src/app/api/public/client/${path}/route.ts`),
        "utf8",
      );
      const executable = src.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(executable).toContain("rejectLegacyMemberRead");
      expect(executable).not.toContain("getPool");
      expect(executable).not.toContain("getClientBalance");
      expect(executable).not.toContain("getClientInventory");
      expect(executable).not.toContain("getStoreItems");
      expect(executable).not.toContain("generateReferralCode");
      expect(executable).not.toContain("searchParams");
      expect(executable).not.toContain("clientIdParam");
      expect(executable).not.toMatch(/Access-Control-Allow-Origin/);
      expect(executable).not.toMatch(/from\s+["']@\/lib\/(?:db|store|loyalty)/);
    }
  });

  it("keeps public packages catalog routes outside this quarantine", () => {
    for (const route of [
      "src/app/api/public/client/packages/route.ts",
      "src/app/api/public/client/packages/[id]/route.ts",
    ]) {
      const src = readFileSync(resolve(process.cwd(), route), "utf8");
      expect(src).toContain("export async function GET");
      expect(src).not.toContain("rejectLegacyMemberRead");
    }
  });
});
