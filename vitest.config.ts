import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never run compiled copies of tests from dist alongside src tests.
    include: ["src/**/*.{test,spec}.{ts,tsx,js,jsx}"],
    exclude: ["node_modules/**", "dist/**", "coverage/**"],
    // Database-backed integration tests are sensitive to parallel connection load.
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
