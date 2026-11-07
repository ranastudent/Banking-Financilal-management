import { redis, ensureRedisConnected } from "../../config/redis";
import { env } from "../../config/env";

const WINDOW_SECONDS = 60 * 60;
const MINUTE_SECONDS = 60;

const incrementWithExpiry = async (key: string, ttlSeconds: number): Promise<number> => {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  return count;
};

/** Redis is deliberately fail-closed: without velocity telemetry a transfer is not assessed as safe. */
export const recordTransferVelocity = async (userId: string, accountId: string) => {
  await ensureRedisConnected();
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const hourBucket = Math.floor(now / 3_600_000);
  const velocityPrefix = `${env.redisKeyPrefix}risk:velocity:`;
  const [userHour, accountHour, userMinute] = await Promise.all([
    incrementWithExpiry(`${velocityPrefix}user:${userId}:hour:${hourBucket}`, WINDOW_SECONDS),
    incrementWithExpiry(`${velocityPrefix}account:${accountId}:hour:${hourBucket}`, WINDOW_SECONDS),
    incrementWithExpiry(`${velocityPrefix}user:${userId}:minute:${minuteBucket}`, MINUTE_SECONDS * 2),
  ]);
  return { transfersLastHour: Math.max(userHour, accountHour), transfersLastMinute: userMinute };
};
