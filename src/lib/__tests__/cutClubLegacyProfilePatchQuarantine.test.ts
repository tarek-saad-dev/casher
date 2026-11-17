import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PATCH, OPTIONS } from "@/app/api/client/update/route";

describe("CUT CLUB unauthenticated profile PATCH quarantine (#272)", () => {
  it.each([["PATCH", PATCH], ["OPTIONS", OPTIONS]])(
    "%s rejects anonymous profile writes with private no-store and no permissive CORS",
    async (_, handler) => {
      const response = await handler();
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
      expect(await response.json()).toEqual({
        ok: false,
        message: "Verified customer sign-in is required to update a profile",
      });
    },
  );

  it("cannot be enabled with forged clientId, staff cookie or auth header", async () => {
    for (const body of [
      { clientId: 1, name: "Spoof" },
      { clientId: 999, phone: "fake" },
      { clientId: "not-a-number", email: "test@example.invalid" },
    ]) {
      const request = new Request("https://example.invalid/api/client/update?branchCode=gleem", {
        method: "PATCH",
        headers: {
          Cookie: "pos_session=fake",
          Authorization: "Bearer fake",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const response = await Reflect.apply(PATCH, undefined, [request]);
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("does not load or call profile mutation/database services", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/client/update/route.ts"),
      "utf8",
    );
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(executable).not.toContain("updateClientWebsiteProfile");
    expect(executable).not.toContain("getPool");
    expect(executable).not.toContain("resolvePublicCatalogTenantId");
    expect(executable).not.toContain("req.json");
    expect(executable).not.toContain("body.clientId");
    expect(executable).not.toMatch(/Access-Control-Allow-Origin/);
    expect(executable).toContain("export async function PATCH()");
  });

  it("fails closed even with legacy debug opt-in", async () => {
    const old = process.env.CUT_CLUB_LEGACY_PROFILE_UPDATE_ENABLED;
    try {
      process.env.CUT_CLUB_LEGACY_PROFILE_UPDATE_ENABLED = "true";
      expect((await PATCH()).status).toBe(403);
    } finally {
      if (old === undefined) delete process.env.CUT_CLUB_LEGACY_PROFILE_UPDATE_ENABLED;
      else process.env.CUT_CLUB_LEGACY_PROFILE_UPDATE_ENABLED = old;
    }
  });
});
