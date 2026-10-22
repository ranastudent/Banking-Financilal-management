import { ensureRedisConnected, redis } from "../config/redis";

const DEFAULT_TTL_SECONDS = 60;

/**
 * Best-effort JSON cache. PostgreSQL remains the source of truth; cache
 * failures are deliberately treated as cache misses so reads can fall back
 * to the database and writes are not failed solely because Redis is down.
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  try {
    await ensureRedisConnected();
    const value = await redis.get(key);
    if (value === null) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      await redis.del(key).catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }
};

export const setCache = async <T>(
  key: string,
  value: T,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> => {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Cache TTL must be a positive integer");
  }

  try {
    await ensureRedisConnected();
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Caching is an optimization; do not fail the primary operation.
  }
};

export const deleteCache = async (key: string): Promise<void> => {
  try {
    await ensureRedisConnected();
    await redis.del(key);
  } catch {
    // The next read can repopulate the cache from PostgreSQL.
  }
};
