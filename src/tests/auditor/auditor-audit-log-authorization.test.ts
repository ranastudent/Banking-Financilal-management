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
      name: `Auditor Audit Test ${Date.now()}-${Math.random()}`,
      email: `auditor-audit-${Date.now()}-${Math.random()}@example.com`,
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

const createTestAuditLog = async (
  userId?: string,
  overrides: {
    action?: string;
    entityType?: string;
    entityId?: string;
    description?: string;
  } = {},
) => {
  const auditLog = await prisma.auditLog.create({
    data: {
      ...(userId !== undefined ? { userId } : {}),
      action:
        overrides.action ?? "TEST_AUDITOR_AUDIT_ACTION",
      entityType:
        overrides.entityType ?? "TEST_ENTITY",
      entityId:
        overrides.entityId ??
        `test-entity-${Date.now()}-${Math.random()}`,
      description:
        overrides.description ??
        "Audit log created for auditor authorization testing",
      ipAddress: "127.0.0.1",
      userAgent: "vitest-supertest",
      metadata: {
        test: true,
        source: "auditor-audit-log-authorization",
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

const createRefreshToken = (user: {
  id: string;
}) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `auditor-audit-${Date.now()}-${Math.random()}`,
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

describe(
  "AUDITOR Audit Log Authorization",
  () => {
    it("should allow AUDITOR to view any audit log by ID", async () => {
      const auditor = await createTestUser("AUDITOR");

      const auditLog = await createTestAuditLog();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/audit-logs/${auditLog.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.auditLog.id,
      ).toBe(auditLog.id);

      expect(
        response.body.data.auditLog.action,
      ).toBe(auditLog.action);

      expect(
        response.body.data.auditLog.entityType,
      ).toBe(auditLog.entityType);

      expect(
        response.body.data.auditLog.entityId,
      ).toBe(auditLog.entityId);
    });

    it("should allow AUDITOR to list audit logs", async () => {
      const auditor = await createTestUser("AUDITOR");

      const first = await createTestAuditLog();
      const second = await createTestAuditLog();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs?page=1&limit=10",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const ids =
        response.body.data.auditLogs.map(
          (log: { id: string }) => log.id,
        );

      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);

      expect(
        response.body.data.pagination.page,
      ).toBe(1);

      expect(
        response.body.data.pagination.limit,
      ).toBe(10);
    });

    it("should allow AUDITOR to inspect ADMIN activity", async () => {
      const auditor = await createTestUser("AUDITOR");
      const admin = await createTestUser("ADMIN");

      const auditLog = await createTestAuditLog(
        admin.id,
        {
          action: "USER_ROLE_CHANGED",
          entityType: "USER",
        },
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/audit-logs/${auditLog.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      expect(
        response.body.data.auditLog.id,
      ).toBe(auditLog.id);

      expect(
        response.body.data.auditLog.user.role,
      ).toBe("ADMIN");
    });

    it("should allow AUDITOR to inspect SUPPORT activity", async () => {
      const auditor = await createTestUser("AUDITOR");
      const support = await createTestUser("SUPPORT");

      const auditLog = await createTestAuditLog(
        support.id,
        {
          action: "SUPPORT_CUSTOMER_OPERATION",
          entityType: "CUSTOMER",
        },
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/audit-logs/${auditLog.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      expect(
        response.body.data.auditLog.id,
      ).toBe(auditLog.id);

      expect(
        response.body.data.auditLog.user.role,
      ).toBe("SUPPORT");
    });

    it("should filter audit logs by action", async () => {
      const auditor = await createTestUser("AUDITOR");

      const target = await createTestAuditLog(
        undefined,
        {
          action: "FX_REQUEST_APPROVAL_DECISION",
        },
      );

      const unrelated = await createTestAuditLog(
        undefined,
        {
          action: "SOME_OTHER_AUDIT_ACTION",
        },
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs?page=1&limit=100",
        )
        .query({
          action: "FX_REQUEST_APPROVAL_DECISION",
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.auditLogs.map(
          (log: { id: string }) => log.id,
        );

      expect(ids).toContain(target.id);
      expect(ids).not.toContain(unrelated.id);
    });

    it("should filter audit logs by entity type", async () => {
      const auditor = await createTestUser("AUDITOR");

      const customerLog = await createTestAuditLog(
        undefined,
        {
          entityType: "CUSTOMER",
        },
      );

      const userLog = await createTestAuditLog(
        undefined,
        {
          entityType: "USER",
        },
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs?page=1&limit=100",
        )
        .query({
          entityType: "CUSTOMER",
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.auditLogs.map(
          (log: { id: string }) => log.id,
        );

      expect(ids).toContain(customerLog.id);
      expect(ids).not.toContain(userLog.id);
    });

    it("should filter audit logs by actor userId", async () => {
      const auditor = await createTestUser("AUDITOR");
      const admin = await createTestUser("ADMIN");

      const adminLog = await createTestAuditLog(
        admin.id,
      );

      const auditorLog = await createTestAuditLog(
        auditor.id,
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs?page=1&limit=100",
        )
        .query({
          userId: admin.id,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.auditLogs.map(
          (log: { id: string }) => log.id,
        );

      expect(ids).toContain(adminLog.id);
      expect(ids).not.toContain(auditorLog.id);
    });

    it("should support pagination for a specific audit actor", async () => {
    const auditor = await createTestUser("AUDITOR");

    await createTestAuditLog(auditor.id);
    await createTestAuditLog(auditor.id);

    const token = createAccessToken(auditor);

    const response = await request(app)
        .get(
        "/api/v1/auditor/audit-logs?page=1&limit=1",
        )
        .query({
        userId: auditor.id,
        })
        .set(
        "Authorization",
        `Bearer ${token}`,
        );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

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

    expect(
        response.body.data.auditLogs[0].user.id,
    ).toBe(auditor.id);
    });

    it("should reject CUSTOMER", async () => {
      const customer = await createTestUser("CUSTOMER");

      const token = createAccessToken(customer);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN", async () => {
      const admin = await createTestUser("ADMIN");

      const token = createAccessToken(admin);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject SUPPORT", async () => {
      const support = await createTestUser("SUPPORT");

      const token = createAccessToken(support);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/audit-logs",
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const auditor = await createTestUser("AUDITOR");

      const refreshToken =
        createRefreshToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
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

    it("should return 404 for a nonexistent audit log", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs/00000000-0000-0000-0000-000000000000",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject an invalid audit log ID", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs/not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject an invalid userId filter", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
        .query({
          userId: "not-a-uuid",
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject invalid pagination parameters", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/audit-logs")
        .query({
          page: 0,
          limit: 101,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should not expose sensitive authentication data", async () => {
      const auditor = await createTestUser("AUDITOR");

      const auditLog = await createTestAuditLog(
        auditor.id,
      );

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/audit-logs/${auditLog.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

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

      expect(
        JSON.stringify(returnedAuditLog),
      ).not.toContain(env.jwtAccessSecret);

      expect(
        JSON.stringify(returnedAuditLog),
      ).not.toContain(env.jwtRefreshSecret);
    });

    it("should include requestId", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/audit-logs?page=1&limit=10",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      expect(
        typeof response.body.requestId,
      ).toBe("string");
    });
  },
);