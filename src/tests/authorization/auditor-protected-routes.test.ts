import { describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const auditorAuditLogUrl =
  "/api/v1/auditor/audit-logs?page=1&limit=1";

const createAccessToken = (role: string) =>
  generateAccessToken({
    id: `auditor-protected-${role.toLowerCase()}`,
    email: `auditor-protected-${role.toLowerCase()}@example.com`,
    role,
    status: "ACTIVE",
  });

describe("9.8.3 AUDITOR Protected Routes", () => {
  it("should allow AUDITOR to access an AUDITOR protected route", async () => {
    const accessToken = createAccessToken("AUDITOR");

    const response = await request(app)
      .get(auditorAuditLogUrl)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toHaveProperty("data");
    expect(response.body).toHaveProperty("requestId");
  });

  it("should reject CUSTOMER from an AUDITOR protected route", async () => {
    const accessToken = createAccessToken("CUSTOMER");

    const response = await request(app)
      .get(auditorAuditLogUrl)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject ADMIN from an AUDITOR protected route", async () => {
    const accessToken = createAccessToken("ADMIN");

    const response = await request(app)
      .get(auditorAuditLogUrl)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from an AUDITOR protected route", async () => {
    const accessToken = createAccessToken("SUPPORT");

    const response = await request(app)
      .get(auditorAuditLogUrl)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to an AUDITOR protected route", async () => {
    const response = await request(app).get(auditorAuditLogUrl);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});