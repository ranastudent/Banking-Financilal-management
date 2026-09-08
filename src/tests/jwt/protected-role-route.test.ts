import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../app";
import { env } from "../../config/env";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Protected Role-Based Route", () => {
  const createAccessToken = (role: string) =>
    generateAccessToken({
      id: `user-${role.toLowerCase()}`,
      email: `${role.toLowerCase()}@example.com`,
      role,
      status: "ACTIVE",
    });

  it("should allow ADMIN to access the admin protected route", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe(
      "Admin route accessed successfully",
    );
    expect(response.body.data.user.role).toBe("ADMIN");
  });

  it("should reject CUSTOMER from the admin protected route", async () => {
    const accessToken = createAccessToken("CUSTOMER");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from the admin protected route", async () => {
    const accessToken = createAccessToken("SUPPORT");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from the admin protected route", async () => {
    const accessToken = createAccessToken("AUDITOR");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject access without an access token", async () => {
    const response = await request(app)
      .get("/api/v1/admin/test");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an invalid access token", async () => {
    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the admin protected route", async () => {
    const jwt = await import("jsonwebtoken");

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

  it("should return the authenticated user's role from req.user", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe("user-admin");
    expect(response.body.data.user.email).toBe("admin@example.com");
    expect(response.body.data.user.role).toBe("ADMIN");
    expect(response.body.data.user.status).toBe("ACTIVE");
  });

  it("should include requestId in the protected response", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});