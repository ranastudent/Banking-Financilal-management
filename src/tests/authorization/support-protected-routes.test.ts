import { describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const createAccessToken = (role: string) =>
  generateAccessToken({
    id: `support-protected-${role.toLowerCase()}`,
    email: `support-protected-${role.toLowerCase()}@example.com`,
    role,
    status: "ACTIVE",
  });

describe("9.8.2 SUPPORT Protected Routes", () => {
  it("should allow SUPPORT to access a SUPPORT protected route", async () => {
    const accessToken = createAccessToken("SUPPORT");

    const response = await request(app)
      .get(
            "/api/v1/support/customers?q=nonexistent-user&page=1&limit=1",
          )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should reject CUSTOMER from a SUPPORT protected route", async () => {
    const accessToken = createAccessToken("CUSTOMER");

    const response = await request(app)
      .get("/api/v1/support/customers?page=1&limit=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject ADMIN from a SUPPORT protected route", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get("/api/v1/support/customers?page=1&limit=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from a SUPPORT protected route", async () => {
    const accessToken = createAccessToken("AUDITOR");

    const response = await request(app)
      .get("/api/v1/support/customers?page=1&limit=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to a SUPPORT protected route", async () => {
    const response = await request(app)
      .get("/api/v1/support/customers?page=1&limit=1");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});