import { afterAll, describe, expect, it } from "vitest";
import { redis } from "../config/redis";

describe("Redis Connection", () => {
  it("should connect to Redis successfully", async () => {
    if (!redis.isOpen) {
      await redis.connect();
    }

    expect(redis.isReady).toBe(true);
  });

  it("should respond to PING with PONG", async () => {
    if (!redis.isOpen) {
      await redis.connect();
    }

    const result = await redis.ping();

    expect(result).toBe("PONG");
  });

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }
  });
});