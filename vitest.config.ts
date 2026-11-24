import { defineConfig } from "vite";
import path from "path";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load .env and .env.local files so DB credentials are available during tests
  const env = loadEnv(mode || "test", process.cwd(), "");
  const includeDbIntegration =
    String(env.INCLUDE_DB_INTEGRATION_TESTS || process.env.INCLUDE_DB_INTEGRATION_TESTS || "")
      .trim()
      .toLowerCase() === "1" ||
    String(env.INCLUDE_DB_INTEGRATION_TESTS || process.env.INCLUDE_DB_INTEGRATION_TESTS || "")
      .trim()
      .toLowerCase() === "true";

  return {
    test: {
      environment: "node",
      globals: false,
      env,
      testTimeout: 30000,
      fileParallelism: false,
      // Fail-closed: mutating DB integration suites are excluded from default
      // `vitest run` / CI unless INCLUDE_DB_INTEGRATION_TESTS=1 AND the suite
      // itself passes assertApprovedTestDatabase (never last132).
      exclude: includeDbIntegration
        ? ["**/node_modules/**", "**/dist/**"]
        : ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Vitest/node cannot load Next's server-only package; stub globally.
        "server-only": path.resolve(__dirname, "./src/test/stubs/server-only.ts"),
      },
    },
  } as any;
});
