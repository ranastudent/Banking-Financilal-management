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