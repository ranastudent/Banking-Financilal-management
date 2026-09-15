import { describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";

const protectedRoutes = [
  {
    name: "ADMIN",
    url: "/api/v1/admin/test",
  },
  {
    name: "SUPPORT",
    url:
      "/api/v1/support/customers?q=nonexistent-user&page=1&limit=1",
  },
  {
    name: "AUDITOR",
    url:
      "/api/v1/auditor/audit-logs?page=1&limit=1",
  },
];

describe("9.8.5 Unauthenticated Protection", () => {
  it.each(protectedRoutes)(
    "should reject unauthenticated access to $name protected routes",
    async ({ url }) => {
      const response = await request(app).get(url);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    },
  );
});