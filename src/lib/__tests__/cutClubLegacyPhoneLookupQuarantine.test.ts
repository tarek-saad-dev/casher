import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GET as lookup, OPTIONS as lookupPreflight } from "@/app/api/client/lookup/route";
import { POST as profile, OPTIONS as profilePreflight } from "@/app/api/public/client/profile/route";

describe("CUT CLUB legacy unverified phone lookup quarantine (#278)", () => {
  it.each([
    ["GET /api/client/lookup", lookup],
    ["OPTIONS /api/client/lookup", lookupPreflight],
    ["POST /api/public/client/profile", profile],
    ["OPTIONS /api/public/client/profile", profilePreflight],
  ])("%s returns generic private 403 regardless of identity", async (_, handler) => {
    const response = await handler();
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toEqual({ ok: false, error: "Verified customer sign-in required" });
  });

  it("ignores phone guesses, ID selectors, Origin, staff and forged bearer tokens", async () => {
    const request = new Request("https://example.invalid/api/client/lookup?mobile=01000000001&clientId=123", {
      headers: { Authorization: "Bearer fake", Cookie: "pos_session=fake", Origin: "https://attacker.invalid" },
    });
    expect((await Reflect.apply(lookup, undefined, [request])).status).toBe(403);

    const profileRequest = new Request("https://example.invalid/api/public/client/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "pos_session=fake" },
      body: JSON.stringify({ phone: "01000000001", clientId: 123 }),
    });
    const response = await Reflect.apply(profile, undefined, [profileRequest]);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not import lookup/DB services or parse caller-selected identity", () => {
    for (const path of [
      "src/app/api/client/lookup/route.ts",
      "src/app/api/public/client/profile/route.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      const executable = source.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(executable).toContain("rejectAnonymousPhoneProfileLookup");
      for (const disallowed of [
        "getPool", "lookupClientByMobile", "searchParams", "req.json",
        "resolvePublicCatalogTenantId", "SELECT ", "clientId", "normalizePhone",
      ]) expect(executable).not.toContain(disallowed);
    }
  });
});
