import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdAuditLogIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin Audit Test ${Date.now()}-${Math.random()}`,
      email: `admin-audit-${Date.now()}-${Math.random()}@example.com`,
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAuditLog = async (userId?: string) => {
  const auditLog = await prisma.auditLog.create({
    data: {
      ...(userId !== undefined ? { userId } : {}),
      action: "TEST_AUDIT_ACTION",
      entityType: "TEST_ENTITY",
      entityId: `test-entity-${Date.now()}-${Math.random()}`,
      description: "Audit log created for authorization testing",
      ipAddress: "127.0.0.1",
      userAgent: "vitest-supertest",
      metadata: {
        test: true,
        source: "admin-audit-log-read-authorization",
      },
    },
  });

  createdAuditLogIds.push(auditLog.id);

  return auditLog;
};

const createAccessToken = (user: {
  id: string;
  email: string;
  role: string;
  status: string;
}) => {
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

const createRefreshToken = (user: { id: string }) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `test-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdAuditLogIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        id: {
          in: createdAuditLogIds,
        },
      },
    });

    createdAuditLogIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
});

describe("ADMIN Audit Log Read Authorization", () => {
  it("should allow ADMIN to view an audit log by ID", async () => {
    const admin = await createTestUser("ADMIN");
    const auditLog = await createTestAuditLog(admin.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.auditLog.id).toBe(auditLog.id);
    expect(response.body.data.auditLog.action).toBe(
      auditLog.action,
    );
    expect(response.body.data.auditLog.entityType).toBe(
      auditLog.entityType,
    );
    expect(response.body.data.auditLog.entityId).toBe(
      auditLog.entityId,
    );
  });

  it("should allow AUDITOR to view an audit log by ID", async () => {
    const auditor = await createTestUser("AUDITOR");
    const auditLog = await createTestAuditLog();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.auditLog.id).toBe(auditLog.id);
  });

  it("should allow SUPPORT to view an audit log by ID", async () => {
    const support = await createTestUser("SUPPORT");
    const auditLog = await createTestAuditLog();

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.auditLog.id).toBe(auditLog.id);
  });

  it("should reject CUSTOMER from viewing an audit log by ID", async () => {
    const customer = await createTestUser("CUSTOMER");
    const auditLog = await createTestAuditLog();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to an audit log by ID", async () => {
    const auditLog = await createTestAuditLog();

    const response = await request(app).get(
      `/api/v1/admin/audit-logs/${auditLog.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the audit log route", async () => {
    const admin = await createTestUser("ADMIN");
    const auditLog = await createTestAuditLog(admin.id);

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested audit log does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/audit-logs/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should not expose sensitive user fields in an audit log response", async () => {
    const admin = await createTestUser("ADMIN");
    const auditLog = await createTestAuditLog(admin.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedAuditLog = response.body.data.auditLog;

    expect(returnedAuditLog).not.toHaveProperty("password");
    expect(returnedAuditLog).not.toHaveProperty("passwordHash");
    expect(returnedAuditLog).not.toHaveProperty("accessToken");
    expect(returnedAuditLog).not.toHaveProperty("refreshToken");

    expect(returnedAuditLog.user).not.toHaveProperty("password");
    expect(returnedAuditLog.user).not.toHaveProperty("passwordHash");
    expect(returnedAuditLog.user).not.toHaveProperty("accessToken");
    expect(returnedAuditLog.user).not.toHaveProperty("refreshToken");
  });

  it("should include requestId for an authorized audit log read", async () => {
    const admin = await createTestUser("ADMIN");
    const auditLog = await createTestAuditLog(admin.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list audit logs with pagination", async () => {
    const admin = await createTestUser("ADMIN");

    await createTestAuditLog(admin.id);
    await createTestAuditLog();
    await createTestAuditLog();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/audit-logs?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("auditLogs");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.auditLogs)).toBe(true);
    expect(response.body.data.auditLogs.length).toBeLessThanOrEqual(
      2,
    );

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
    expect(typeof response.body.data.pagination.total).toBe("number");
    expect(typeof response.body.data.pagination.totalPages).toBe(
      "number",
    );
  });

  it("should allow AUDITOR to list audit logs", async () => {
    const auditor = await createTestUser("AUDITOR");

    await createTestAuditLog();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get("/api/v1/admin/audit-logs?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.auditLogs)).toBe(true);
  });

  it("should allow SUPPORT to list audit logs", async () => {
    const support = await createTestUser("SUPPORT");

    await createTestAuditLog();

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/admin/audit-logs?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.auditLogs)).toBe(true);
  });

  it("should reject CUSTOMER from listing audit logs", async () => {
    const customer = await createTestUser("CUSTOMER");

    const token = createAccessToken(customer);

    const response = await request(app)
      .get("/api/v1/admin/audit-logs?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/audit-logs?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});