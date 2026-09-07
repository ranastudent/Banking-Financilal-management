import { describe, expect, it } from "vitest";

import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";

describe("Refresh Token Hash Utility", () => {
  it("should generate a SHA-256 hash", () => {
    const token = "test-refresh-token";

    const hash = hashRefreshToken(token);

    expect(hash).toBeTypeOf("string");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should generate the same hash for the same token", () => {
    const token = "test-refresh-token";

    const firstHash = hashRefreshToken(token);
    const secondHash = hashRefreshToken(token);

    expect(firstHash).toBe(secondHash);
  });

  it("should generate different hashes for different tokens", () => {
    const firstHash = hashRefreshToken("refresh-token-1");
    const secondHash = hashRefreshToken("refresh-token-2");

    expect(firstHash).not.toBe(secondHash);
  });

  it("should not return the original token", () => {
    const token = "test-refresh-token";

    const hash = hashRefreshToken(token);

    expect(hash).not.toBe(token);
  });
});