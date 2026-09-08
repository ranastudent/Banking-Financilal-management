import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../app";
import { env } from "../../config/env";
import { generateAccessToken } from "../../auth/utils/jwt";
import jwt from "jsonwebtoken";

describe("Authorization Integration Tests", () => {
  const createAccessToken = (role: string) =>
    generateAccessToken({
      id: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.com`,
      role,
      status: "ACTIVE",
    });

  it("should allow ADMIN to access an ADMIN-only route", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe("ADMIN");
  });

  it("should reject CUSTOMER from an ADMIN-only route", async () => {
    const accessToken = createAccessToken("CUSTOMER");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from an ADMIN-only route", async () => {
    const accessToken = createAccessToken("SUPPORT");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from an ADMIN-only route", async () => {
    const accessToken = createAccessToken("AUDITOR");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access with 401", async () => {
    const response = await request(app)
      .get("/api/v1/admin/test");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an invalid access token with 401", async () => {
    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token from an ADMIN-only route", async () => {
    const refreshToken = jwt.sign(
      {
        sub: "admin-123",
        tokenType: "refresh",
        jti: "refresh-jti-123",
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "7d",
      },
    );

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return the authenticated identity from req.user", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    expect(response.body.data.user).toEqual({
      id: "user-admin",
      email: "admin@example.com",
      role: "ADMIN",
      status: "ACTIVE",
    });
  });

  it("should include requestId for an authorized request", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("should not expose sensitive authentication data", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const responseText = JSON.stringify(response.body);

    expect(responseText).not.toContain(accessToken);
    expect(responseText).not.toContain("password");
    expect(responseText).not.toContain("passwordHash");
    expect(responseText).not.toContain("refreshToken");
  });
});