import {
  describe,
  expect,
  it,
} from "vitest";

import { extractBearerToken } from "../../utils/bearerToken";

describe("Authorization Header Parsing", () => {
  // ============================================================
  // Missing Header
  // ============================================================

  it("should reject a missing Authorization header", () => {
    expect(() => {
      extractBearerToken(undefined);
    }).toThrow("Authentication required");
  });

  // ============================================================
  // Empty Header
  // ============================================================

  it("should reject an empty Authorization header", () => {
    expect(() => {
        extractBearerToken("");
    }).toThrow("Authentication required");
  });

  // ============================================================
  // Whitespace-only Header
  // ============================================================

  it("should reject a whitespace-only Authorization header", () => {
    expect(() => {
      extractBearerToken("   ");
    }).toThrow("Invalid authorization header");
  });

  // ============================================================
  // Invalid Scheme
  // ============================================================

  it("should reject a non-Bearer authorization scheme", () => {
    expect(() => {
      extractBearerToken("Basic abc123");
    }).toThrow("Invalid authorization header");
  });

  // ============================================================
  // Bearer Without Token
  // ============================================================

  it("should reject Bearer without a token", () => {
    expect(() => {
      extractBearerToken("Bearer");
    }).toThrow("Invalid authorization header");
  });

  // ============================================================
  // Bearer With Empty Token
  // ============================================================

  it("should reject Bearer with only whitespace after it", () => {
    expect(() => {
      extractBearerToken("Bearer   ");
    }).toThrow("Invalid authorization header");
  });

  // ============================================================
  // Extra Credentials
  // ============================================================

  it("should reject a Bearer header containing multiple credentials", () => {
    expect(() => {
      extractBearerToken("Bearer token123 extra");
    }).toThrow("Invalid authorization header");
  });

  // ============================================================
  // Valid Bearer Token
  // ============================================================

  it("should extract a valid Bearer token", () => {
    const token = extractBearerToken(
      "Bearer abc123",
    );

    expect(token).toBe("abc123");
  });

  // ============================================================
  // Multiple Spaces
  // ============================================================

  it("should handle multiple spaces between scheme and token", () => {
    const token = extractBearerToken(
      "Bearer    abc123",
    );

    expect(token).toBe("abc123");
  });

  // ============================================================
  // Leading / Trailing Whitespace
  // ============================================================

  it("should handle leading and trailing whitespace", () => {
    const token = extractBearerToken(
      "   Bearer abc123   ",
    );

    expect(token).toBe("abc123");
  });

  // ============================================================
  // Case-Insensitive Bearer Scheme
  // ============================================================

  it("should accept a case-insensitive Bearer scheme", () => {
    expect(
      extractBearerToken("bearer abc123"),
    ).toBe("abc123");

    expect(
      extractBearerToken("BEARER abc123"),
    ).toBe("abc123");

    expect(
      extractBearerToken("BeArEr abc123"),
    ).toBe("abc123");
  });

  // ============================================================
  // Token Content
  // ============================================================

  it("should return the complete token without modification", () => {
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature";

    expect(
      extractBearerToken(`Bearer ${token}`),
    ).toBe(token);
  });
});