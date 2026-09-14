import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdAuditLogIds: string[] = [];
const createdUserIds: string[] = [];

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Support Audit ${role} ${crypto.randomUUID()}`,
      email: `support-audit-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      phone: null,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createAuditLog = async (
  userId: string,
  action: string,
  entityType = "CUSTOMER",
) => {
  const auditLog = await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId: crypto.randomUUID(),
      description:
        "Support audit trail authorization test",
      ipAddress: "127.0.0.1",
      userAgent: "vitest-supertest",
      metadata: {
        source: "support-audit-test",
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

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: `support-audit-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdAuditLogIds.length > 0) {
    const ids = [...createdAuditLogIds];
    createdAuditLogIds.length = 0;

    await prisma.auditLog.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  if (createdUserIds.length > 0) {
    const ids = [...createdUserIds];
    createdUserIds.length = 0;

    await prisma.user.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
});

describe("SUPPORT Audit Trail Authorization", () => {
  it("should allow SUPPORT to view a support audit log by ID", async () => {
    const support = await createUser("SUPPORT");

    const auditLog = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/audit-logs/${auditLog.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(
      response.body.data.auditLog.id,
    ).toBe(auditLog.id);

    expect(
      response.body.data.auditLog.action,
    ).toBe("SUPPORT_CUSTOMER_OPERATION");
  });

  it("should allow SUPPORT to list support audit logs", async () => {
    const support = await createUser("SUPPORT");

    const first = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const second = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/support/audit-logs?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const ids =
      response.body.data.auditLogs.map(
        (log: { id: string }) => log.id,
      );

    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
  });

  it("should not return an ADMIN audit log", async () => {
    const support = await createUser("SUPPORT");
    const admin = await createUser("ADMIN");

    const adminLog = await createAuditLog(
      admin.id,
      "USER_ROLE_CHANGED",
      "USER",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/support/audit-logs?page=1&limit=100")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const ids =
      response.body.data.auditLogs.map(
        (log: { id: string }) => log.id,
      );

    expect(ids).not.toContain(adminLog.id);
  });

  it("should not return a non-SUPPORT actor even with a SUPPORT action", async () => {
    const support = await createUser("SUPPORT");
    const admin = await createUser("ADMIN");

    const adminLog = await createAuditLog(
      admin.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/support/audit-logs?page=1&limit=100")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const ids =
      response.body.data.auditLogs.map(
        (log: { id: string }) => log.id,
      );

    expect(ids).not.toContain(adminLog.id);
  });

  it("should filter by SUPPORT action", async () => {
    const support = await createUser("SUPPORT");

    const supportOperationLog =
      await createAuditLog(
        support.id,
        "SUPPORT_CUSTOMER_OPERATION",
      );

    const anotherSupportLog =
      await createAuditLog(
        support.id,
        "SUPPORT_OTHER_OPERATION",
      );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/audit-logs?page=1&limit=100",
      )
      .query({
        action: "SUPPORT_CUSTOMER_OPERATION",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const ids =
      response.body.data.auditLogs.map(
        (log: { id: string }) => log.id,
      );

    expect(ids).toContain(
      supportOperationLog.id,
    );

    expect(ids).not.toContain(
      anotherSupportLog.id,
    );
  });

  it("should filter by entity type", async () => {
    const support = await createUser("SUPPORT");

    const customerLog = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
      "CUSTOMER",
    );

    const userLog = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
      "USER",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/audit-logs?page=1&limit=100",
      )
      .query({
        entityType: "CUSTOMER",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const ids =
      response.body.data.auditLogs.map(
        (log: { id: string }) => log.id,
      );

    expect(ids).toContain(customerLog.id);
    expect(ids).not.toContain(userLog.id);
  });

  it("should support pagination", async () => {
    const support = await createUser("SUPPORT");

    await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/audit-logs?page=1&limit=1",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(
      response.body.data.auditLogs,
    ).toHaveLength(1);

    expect(
      response.body.data.pagination.page,
    ).toBe(1);

    expect(
      response.body.data.pagination.limit,
    ).toBe(1);

    expect(
      response.body.data.pagination.total,
    ).toBe(2);

    expect(
      response.body.data.pagination.totalPages,
    ).toBe(2);
  });

  it("should reject CUSTOMER", async () => {
    const customer = await createUser("CUSTOMER");

    const token = createAccessToken(customer);

    const response = await request(app)
      .get("/api/v1/support/audit-logs")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject ADMIN", async () => {
    const admin = await createUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/support/audit-logs")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject AUDITOR", async () => {
    const auditor = await createUser("AUDITOR");

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get("/api/v1/support/audit-logs")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject unauthenticated access", async () => {
    const response = await request(app).get(
      "/api/v1/support/audit-logs",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject a refresh token", async () => {
    const support = await createUser("SUPPORT");

    const refreshToken =
      createRefreshToken(support.id);

    const response = await request(app)
      .get("/api/v1/support/audit-logs")
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should return 404 for a non-support audit log by ID", async () => {
    const support = await createUser("SUPPORT");
    const admin = await createUser("ADMIN");

    const adminLog = await createAuditLog(
      admin.id,
      "USER_STATUS_CHANGED",
      "USER",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/audit-logs/${adminLog.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject an invalid audit log ID", async () => {
    const support = await createUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/audit-logs/not-a-uuid",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject an invalid action filter", async () => {
    const support = await createUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/support/audit-logs")
      .query({
        action: "USER_ROLE_CHANGED",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should not expose sensitive authentication fields", async () => {
    const support = await createUser("SUPPORT");

    const auditLog = await createAuditLog(
      support.id,
      "SUPPORT_CUSTOMER_OPERATION",
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/audit-logs/${auditLog.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedAuditLog =
      response.body.data.auditLog;

    expect(returnedAuditLog).not.toHaveProperty(
      "password",
    );

    expect(returnedAuditLog).not.toHaveProperty(
      "passwordHash",
    );

    expect(returnedAuditLog).not.toHaveProperty(
      "accessToken",
    );

    expect(returnedAuditLog).not.toHaveProperty(
      "refreshToken",
    );

    expect(
      returnedAuditLog.user,
    ).not.toHaveProperty("password");

    expect(
      returnedAuditLog.user,
    ).not.toHaveProperty("passwordHash");

    expect(
      returnedAuditLog.user,
    ).not.toHaveProperty("accessToken");

    expect(
      returnedAuditLog.user,
    ).not.toHaveProperty("refreshToken");
  });

  it("should include requestId", async () => {
    const support = await createUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/audit-logs?page=1&limit=10",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(
      typeof response.body.requestId,
    ).toBe("string");
  });
});