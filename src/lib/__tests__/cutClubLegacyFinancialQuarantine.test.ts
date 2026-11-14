import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { POST as purchase, OPTIONS as purchasePreflight } from "@/app/api/public/client/store/buy/route";
import { POST as openBox, OPTIONS as boxPreflight } from "@/app/api/public/client/store/open-box/route";
import {
  LEGACY_FINANCIAL_WRITES_QUARANTINED,
  rejectUnauthenticatedFinancialWrite,
} from "@/lib/cut-club/legacyFinancialQuarantine";

const endpoints = [
  ["purchase", purchase, purchasePreflight],
  ["mystery box", openBox, boxPreflight],
] as const;

describe("CUT CLUB legacy public financial mutation quarantine", () => {
  it("has an unconditional compile-time quarantine, not a user-toggleable flag", () => {
    expect(LEGACY_FINANCIAL_WRITES_QUARANTINED).toBe(true);
  });

  for (const [name, post, options] of endpoints) {
    it(name + " rejects POST before parsing clientId, credentials, or body", async () => {
      // The handler intentionally accepts no request at all. It cannot
      // derive identity from a URL, JSON body, staff cookie or Authorization.
      const response = await post();
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await response.json()).toEqual({
        ok: false,
        error: "CUT CLUB purchases require verified customer sign-in",
      });
    });

    it(name + " does not grant preflight CORS permission", async () => {
      const response = await options();
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });
  }

  it("cannot be activated by legacy debug flags in any environment", async () => {
    const keys = [
      "CUT_CLUB_LEGACY_DEVELOPMENT",
      "CUT_CLUB_ALLOW_PUBLIC_MUTATIONS",
      "CUT_CLUB_PURCHASES_ENABLED",
    ] as const;
    const saved = keys.map(key => process.env[key]);
    try {
      for (const key of keys) process.env[key] = "true";
      expect((await rejectUnauthenticatedFinancialWrite()).status).toBe(403);
      expect((await purchase()).status).toBe(403);
      expect((await openBox()).status).toBe(403);
    } finally {
      keys.forEach((key, i) => {
        if (saved[i] === undefined) delete process.env[key];
        else process.env[key] = saved[i];
      });
    }
  });

  it("routes do not import DB, purchase, inventory, or gift issuance services", () => {
    const paths = [
      "src/app/api/public/client/store/buy/route.ts",
      "src/app/api/public/client/store/open-box/route.ts",
    ];
    for (const path of paths) {
      const src = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(src).toContain("rejectUnauthenticatedFinancialWrite");
      expect(src).not.toContain("purchaseStoreItem");
      expect(src).not.toContain("openMysteryBox");
      expect(src).not.toContain("getPool");
      expect(src).not.toContain("clientIdParam");
      expect(src).not.toMatch(/Access-Control-Allow-Origin/);
    }
  });
});
