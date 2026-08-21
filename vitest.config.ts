import { defineConfig } from "vite";
import path from "path";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load .env and .env.local files so DB credentials are available during tests
  const env = loadEnv(mode || "test", process.cwd(), "");
  return {
    test: {
      environment: "node",
      globals: false,
      env,
      testTimeout: 30000,
      fileParallelism: false,
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
