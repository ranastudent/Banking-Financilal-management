import { redis } from "../config/redis";

const CACHE_PREFIX = "banking:cache:v1:";
const GROUP_PREFIX = `${CACHE_PREFIX}group:`;
const DEFAULT_TTL_SECONDS = 30;

const inFlightLoads = new Map<string, Promise<unknown>>();

const cacheKey = (key: string): string => `${CACHE_PREFIX}${key}`;
const groupKey = (group: string): string => `${GROUP_PREFIX}${group}`;

/**
 * Best-effort Redis cache for non-authoritative read models.
 * Redis failures are deliberately fail-open: callers fall back to PostgreSQL.
 * Never use this service to make balance, ledger, authorization, or transaction decisions.
 */
export const cacheService = {
  async get<T>(key: string): Promise<T | null> {
    if (!redis.isReady) return null;

    try {
      const value = await redis.get(cacheKey(key));
      if (value === null) return null;

      try {
        return JSON.parse(value) as T;
      } catch {
        // Corrupt cache entries are discarded and treated as a miss.
        await redis.del(cacheKey(key)).catch(() => undefined);
        return null;
      }
    } catch (error) {
      console.warn("Cache read failed; falling back to source of truth.", error);
      return null;
    }
  },

  async set<T>(
    key: string,
    value: T,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    groups: string[] = [],
  ): Promise<void> {
    if (!redis.isReady || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      return;
    }

    const fullKey = cacheKey(key);

    try {
      await redis.set(fullKey, JSON.stringify(value), { EX: ttlSeconds });

      // Group indexes make related entries invalidatable without KEYS/blocking scans.
      for (const group of new Set(groups)) {
        const indexKey = groupKey(group);
        await redis.sAdd(indexKey, fullKey);
        // The index must outlive the longest cache entry that it tracks.
        await redis.expire(indexKey, Math.max(ttlSeconds, 60));
      }
    } catch (error) {
      // A failed cache write must never fail an otherwise valid read request.
      console.warn("Cache write failed; continuing without cache.", error);
    }
  },

  async delete(key: string): Promise<void> {
    if (!redis.isReady) return;

    try {
      await redis.del(cacheKey(key));
    } catch (error) {
      console.warn("Cache deletion failed; entry will expire by TTL.", error);
    }
  },

  async invalidateGroup(group: string): Promise<void> {
    if (!redis.isReady) return;

    const indexKey = groupKey(group);

    try {
      const keys = await redis.sMembers(indexKey);
      if (keys.length > 0) {
        await redis.del(keys);
      }
      await redis.del(indexKey);
    } catch (error) {
      // Short TTLs bound stale data if Redis invalidation is temporarily unavailable.
      console.warn("Cache group invalidation failed; entries will expire by TTL.", error);
    }
  },

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    groups: string[] = [],
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // Coalesce same-process cache misses to reduce duplicate database reads.
    const existingLoad = inFlightLoads.get(key);
    if (existingLoad) return existingLoad as Promise<T>;

    const load = (async () => {
      const value = await loader();
      if (value !== null && value !== undefined) {
        await this.set(key, value, ttlSeconds, groups);
      }
      return value;
    })();

    inFlightLoads.set(key, load);
    try {
      return await load;
    } finally {
      if (inFlightLoads.get(key) === load) inFlightLoads.delete(key);
    }
  },
};

export const cacheKeys = {
  userProfile: (userId: string) => `user:profile:${userId}`,
  adminUser: (userId: string) => `admin:user:${userId}`,
  adminUserList: (page: number, limit: number) => `admin:users:${page}:${limit}`,
};

export const cacheGroups = {
  user: (userId: string) => `user:${userId}`,
  adminUser: (userId: string) => `admin:user:${userId}`,
  adminUsers: "admin:users",
};
