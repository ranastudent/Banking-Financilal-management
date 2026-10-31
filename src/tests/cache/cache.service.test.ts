
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisMock, values, sets } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const redisMock = {
    isReady: true,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        values.delete(key);
        sets.delete(key);
        for (const group of sets.values()) group.delete(key);
      }
      return list.length;
    }),
    sAdd: vi.fn(async (key: string, value: string) => {
      const members = sets.get(key) ?? new Set<string>();
      const before = members.size;
      members.add(value);
      sets.set(key, members);
      return members.size === before ? 0 : 1;
    }),
    sMembers: vi.fn(async (key: string) => [...(sets.get(key) ?? new Set<string>())]),
    expire: vi.fn(async () => true),
  };
  return { redisMock, values, sets };
});

vi.mock("../../config/redis", () => ({ redis: redisMock }));

import { cacheGroups, cacheKeys, cacheService } from "../../services/cache.service";

describe("Redis cache service", () => {
  beforeEach(() => {
    values.clear();
    sets.clear();
    redisMock.isReady = true;
    vi.clearAllMocks();
    redisMock.get.mockImplementation(async (key: string) => values.get(key) ?? null);
    redisMock.set.mockImplementation(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    });
    redisMock.del.mockImplementation(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        values.delete(key);
        sets.delete(key);
        for (const group of sets.values()) group.delete(key);
      }
      return list.length;
    });
    redisMock.sAdd.mockImplementation(async (key: string, value: string) => {
      const members = sets.get(key) ?? new Set<string>();
      const before = members.size;
      members.add(value);
      sets.set(key, members);
      return members.size === before ? 0 : 1;
    });
    redisMock.sMembers.mockImplementation(async (key: string) => [...(sets.get(key) ?? new Set<string>())]);
  });

  it("serializes and deserializes cached JSON values", async () => {
    const profile = { id: "user-1", name: "Test User" };
    await cacheService.set("test:profile", profile, 30);

    await expect(cacheService.get("test:profile")).resolves.toEqual(profile);
    expect(redisMock.set).toHaveBeenCalledWith(
      "banking:cache:v1:test:profile",
      JSON.stringify(profile),
      { EX: 30 },
    );
  });

  it("invalidates all cache entries registered in a group", async () => {
    await cacheService.set(cacheKeys.userProfile("u-1"), { id: "u-1" }, 30, [cacheGroups.user("u-1")]);
    await cacheService.set(cacheKeys.adminUser("u-1"), { id: "u-1" }, 15, [cacheGroups.user("u-1")]);

    await cacheService.invalidateGroup(cacheGroups.user("u-1"));

    await expect(cacheService.get(cacheKeys.userProfile("u-1"))).resolves.toBeNull();
    await expect(cacheService.get(cacheKeys.adminUser("u-1"))).resolves.toBeNull();
  });

  it("fails open when Redis reads and writes fail", async () => {
    redisMock.get.mockRejectedValueOnce(new Error("Redis unavailable"));
    redisMock.set.mockRejectedValueOnce(new Error("Redis unavailable"));
    const loader = vi.fn().mockResolvedValue({ source: "postgres" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(cacheService.getOrSet("failure:test", loader, 10)).resolves.toEqual({ source: "postgres" });
    expect(loader).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("coalesces concurrent cache misses into one loader call", async () => {
    let resolveLoader!: (value: { id: string }) => void;
    const loader = vi.fn(() => new Promise<{ id: string }>((resolve) => { resolveLoader = resolve; }));

    const first = cacheService.getOrSet("concurrent:test", loader, 20);
    const second = cacheService.getOrSet("concurrent:test", loader, 20);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    resolveLoader({ id: "loaded-once" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { id: "loaded-once" },
      { id: "loaded-once" },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("uses the source loader when Redis is not ready", async () => {
    redisMock.isReady = false;
    const loader = vi.fn().mockResolvedValue({ authoritative: true });

    await expect(cacheService.getOrSet("redis:closed", loader)).resolves.toEqual({ authoritative: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});
