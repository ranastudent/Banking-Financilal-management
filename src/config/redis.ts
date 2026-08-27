import { createClient } from "redis";
import { env } from "./env";

export const redis = createClient({
  url: env.redisUrl,
});

redis.on("error", (error) => {
  console.error("Redis Client Error:", error);
});