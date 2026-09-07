import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../auth/utils/jwt";

import { env } from "../config/env";

describe("JWT Utility", () => {
  const user = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "jwt-test@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  it("should generate a valid refresh token", () => {
    const token = generateRefreshToken(user);

    expect(token).toBeTypeOf("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = jwt.verify(
      token,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(decoded.sub).toBe(user.id);
    expect(decoded.tokenType).toBe("refresh");
    expect(decoded.jti).toBeDefined();
    expect(decoded.jti).toBeTypeOf("string");
    expect(decoded.exp).toBeDefined();
  });

  it("should generate a valid refresh token", () => {
    const token = generateRefreshToken(user);

    expect(token).toBeTypeOf("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = jwt.verify(
      token,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(decoded.sub).toBe(user.id);
    expect(decoded.tokenType).toBe("refresh");
    expect(decoded.exp).toBeDefined();
  });

  it("should not verify an access token with the refresh secret", () => {
    const token = generateAccessToken(user);

    expect(() => {
      jwt.verify(token, env.jwtRefreshSecret);
    }).toThrow();
  });

  it("should not verify a refresh token with the access secret", () => {
    const token = generateRefreshToken(user);

    expect(() => {
      jwt.verify(token, env.jwtAccessSecret);
    }).toThrow();
  });

  it("should generate different access and refresh tokens", () => {
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    expect(accessToken).not.toBe(refreshToken);
  });
});