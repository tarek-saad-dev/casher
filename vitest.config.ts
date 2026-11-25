import { defineConfig } from "vite";
import path from "path";
import { loadEnv } from "vite";
import { configDefaults } from "vitest/config";

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
      // Extend Vitest defaults so dist/node_modules/.git/etc stay excluded.
      exclude: includeDbIntegration
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, "**/*.integration.test.ts"],
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
