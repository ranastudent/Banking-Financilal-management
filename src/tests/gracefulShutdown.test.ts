import { describe, expect, it, vi, beforeEach } from "vitest";
import http from "node:http";

import {
  shutdown,
  resetShutdownState,
} from "../utils/shutdown";

import { prisma } from "../config/prisma";
import { redis } from "../config/redis";

describe("Graceful Shutdown", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetShutdownState();
  });

  it("should close the HTTP server and disconnect PostgreSQL and Redis", async () => {
    const server = http.createServer();

    vi.spyOn(server, "close").mockImplementation(
      (callback?: (err?: Error) => void) => {
        callback?.();
        return server;
      },
    );

    vi.spyOn(prisma, "$disconnect").mockResolvedValue();

    Object.defineProperty(redis, "isOpen", {
      value: true,
      configurable: true,
    });

    vi.spyOn(redis, "quit").mockResolvedValue("OK");

    await shutdown(server, "SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });

  it("should not run shutdown twice", async () => {
    const server = http.createServer();

    vi.spyOn(server, "close").mockImplementation(
      (callback?: (err?: Error) => void) => {
        callback?.();
        return server;
      },
    );

    vi.spyOn(prisma, "$disconnect").mockResolvedValue();

    Object.defineProperty(redis, "isOpen", {
      value: false,
      configurable: true,
    });

    const firstShutdown = shutdown(server, "SIGTERM");
    const secondShutdown = shutdown(server, "SIGINT");

    await Promise.all([
      firstShutdown,
      secondShutdown,
    ]);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });
});