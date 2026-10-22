import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { env } from "../../config/env";

/**
 * Use a dedicated client in this test. Closing the application's shared
 * singleton here can break unrelated Express integration tests that still
 * use the Redis-backed rate limiters.
 */
const testRedis = createClient({ url: env.redisUrl });

testRedis.on("error", (error) => {
  console.error("Redis connection test client error:", error);
});

describe("Redis Connection", () => {
  beforeAll(async () => {
    if (!testRedis.isOpen) await testRedis.connect();
  });

  it("should connect to Redis successfully", () => {
    expect(testRedis.isReady).toBe(true);
  });

  it("should respond to PING with PONG", async () => {
    expect(await testRedis.ping()).toBe("PONG");
  });

  afterAll(async () => {
    if (testRedis.isOpen) await testRedis.quit();
  });
});
