import { describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const createAccessToken = (role: string) =>
  generateAccessToken({
    id: `protected-route-${role.toLowerCase()}`,
    email: `protected-${role.toLowerCase()}@example.com`,
    role,
    status: "ACTIVE",
  });

describe("9.8.1 ADMIN Protected Routes", () => {
  it("should allow ADMIN to access an ADMIN protected route", async () => {
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

  it("should reject CUSTOMER from an ADMIN protected route", async () => {
    const accessToken = createAccessToken("CUSTOMER");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from an ADMIN protected route", async () => {
    const accessToken = createAccessToken("SUPPORT");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from an ADMIN protected route", async () => {
    const accessToken = createAccessToken("AUDITOR");

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to an ADMIN protected route", async () => {
    const response = await request(app).get(
      "/api/v1/admin/test",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});