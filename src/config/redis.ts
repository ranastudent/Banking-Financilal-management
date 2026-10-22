import { createClient } from "redis";
import { env } from "./env";

export const redis = createClient({
  url: env.redisUrl,
});

redis.on("connect", () => {
  console.log("Redis connecting...");
});

redis.on("ready", () => {
  console.log("Redis ready");
});

redis.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

redis.on("end", () => {
  console.log("Redis connection closed");
});

redis.on("error", (error) => {
  console.error("Redis Client Error:", error);
});

/**
 * Ensure the shared Redis client is connected before it is used.
 *
 * The promise is shared so concurrent first requests do not attempt to
 * connect the same node-redis client multiple times. The server also calls
 * this before listening; the middleware uses it as a safety net for tests
 * and other callers that import the Express app without starting server.ts.
 */
let connectionPromise: Promise<void> | null = null;

export const ensureRedisConnected = async (): Promise<void> => {
  if (redis.isReady) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    if (!redis.isOpen) {
      await redis.connect();
      return;
    }

    // The client may already be opening because another caller initiated it.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        redis.off("ready", onReady);
        redis.off("error", onError);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      redis.once("ready", onReady);
      redis.once("error", onError);

      if (redis.isReady) onReady();
    });
  })().finally(() => {
    connectionPromise = null;
  });

  return connectionPromise;
};
