import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the dedicated integration-test environment before Vitest imports test
// modules (and before src/config/env.ts evaluates its required variables).
process.env.NODE_ENV = "test";

const testEnvPath = resolve(process.cwd(), ".env.test");

if (!existsSync(testEnvPath)) {
  throw new Error(
    `Missing ${testEnvPath}. Copy src/.env.test.example to the backend project root as .env.test, then configure dedicated test-only services.`,
  );
}

const envResult = loadEnv({ path: testEnvPath });

if (envResult.error) {
  throw envResult.error;
}

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
