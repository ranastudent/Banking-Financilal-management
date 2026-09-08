import {
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { env } from "../../config/env";

describe("Protected Route", () => {
  const user = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "protected@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const createAccessToken = (): string => {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: "15m",
      },
    );
  };

  it("should reject access to the protected route without a token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("should reject access to the protected route with an invalid token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("should allow access with a valid access token", async () => {
    const accessToken = createAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toEqual(user);
  });

  it("should return the authenticated user from req.user", async () => {
    const accessToken = createAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.data.id).toBe(user.id);
    expect(response.body.data.email).toBe(user.email);
    expect(response.body.data.role).toBe(user.role);
    expect(response.body.data.status).toBe(user.status);
  });

  it("should include the requestId in the protected response", async () => {
    const accessToken = createAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });
});