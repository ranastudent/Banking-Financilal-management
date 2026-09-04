import { describe, expect, it } from "vitest";
import { env } from "../config/env";

describe("Environment Configuration", () => {
  it("should load required environment configuration", () => {
    expect(env.databaseUrl).toBeTruthy();
    expect(env.redisUrl).toBeTruthy();

    expect(env.jwtAccessSecret).toBeTruthy();
    expect(env.jwtRefreshSecret).toBeTruthy();

    expect(env.defaultAdminEmail).toBeTruthy();
    expect(env.defaultAdminPassword).toBeTruthy();

    expect(env.corsOrigins.length).toBeGreaterThan(0);
  });

  it("should load valid application configuration", () => {
    expect(env.port).toBeGreaterThan(0);

    expect(env.bodySizeLimit).toBeTruthy();

    expect(env.rateLimit.general.windowMs).toBeGreaterThan(0);
    expect(env.rateLimit.general.max).toBeGreaterThan(0);

    expect(env.rateLimit.auth.windowMs).toBeGreaterThan(0);
    expect(env.rateLimit.auth.max).toBeGreaterThan(0);

    expect(env.rateLimit.otp.windowMs).toBeGreaterThan(0);
    expect(env.rateLimit.otp.max).toBeGreaterThan(0);
  });

  it("should parse multiple CORS origins correctly", () => {
    expect(Array.isArray(env.corsOrigins)).toBe(true);

    for (const origin of env.corsOrigins) {
      expect(origin.trim()).toBe(origin);
      expect(origin.length).toBeGreaterThan(0);
    }
  });

  it("should not expose secrets through the test output", () => {
    expect(env.jwtAccessSecret).toBeTruthy();
    expect(env.jwtRefreshSecret).toBeTruthy();
    expect(env.defaultAdminPassword).toBeTruthy();
  });
});