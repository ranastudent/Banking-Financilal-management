import { describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const adminRoute = "/api/v1/admin/test";

const supportRoute =
  "/api/v1/support/customers?q=nonexistent-user&page=1&limit=1";

const auditorRoute =
  "/api/v1/auditor/audit-logs?page=1&limit=1";

const createAccessToken = (role: string) =>
  generateAccessToken({
    id: `cross-role-${role.toLowerCase()}`,
    email: `cross-role-${role.toLowerCase()}@example.com`,
    role,
    status: "ACTIVE",
  });

const expectForbidden = async (
  role: string,
  route: string,
) => {
  const accessToken = createAccessToken(role);

  const response = await request(app)
    .get(route)
    .set("Authorization", `Bearer ${accessToken}`);

  expect(response.status).toBe(403);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe("FORBIDDEN");
};

describe("9.8.4 Cross-role Denial", () => {
  it("should deny CUSTOMER from ADMIN routes", async () => {
    await expectForbidden("CUSTOMER", adminRoute);
  });

  it("should deny CUSTOMER from SUPPORT routes", async () => {
    await expectForbidden("CUSTOMER", supportRoute);
  });

  it("should deny CUSTOMER from AUDITOR routes", async () => {
    await expectForbidden("CUSTOMER", auditorRoute);
  });

  it("should deny SUPPORT from ADMIN routes", async () => {
    await expectForbidden("SUPPORT", adminRoute);
  });

  it("should deny SUPPORT from AUDITOR routes", async () => {
    await expectForbidden("SUPPORT", auditorRoute);
  });

  it("should deny ADMIN from SUPPORT routes", async () => {
    await expectForbidden("ADMIN", supportRoute);
  });

  it("should deny ADMIN from AUDITOR routes", async () => {
    await expectForbidden("ADMIN", auditorRoute);
  });

  it("should deny AUDITOR from ADMIN routes", async () => {
    await expectForbidden("AUDITOR", adminRoute);
  });

  it("should deny AUDITOR from SUPPORT routes", async () => {
    await expectForbidden("AUDITOR", supportRoute);
  });
});