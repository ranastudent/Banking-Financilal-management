import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import app from "../../app";
import { hashPassword } from "../../auth/utils/password";
import { generateAccessToken } from "../../auth/utils/jwt";
import {
  UserRole,
  UserStatus,
} from "@prisma/client";

const createdUserIds: string[] = [];
const createdAuditLogIds: string[] = [];

const createUser = async (
  role: UserRole,
  status: UserStatus,
) => {
  const passwordHash = await hashPassword("TestPassword123!");

  const user = await prisma.user.create({
    data: {
      name: `Audit Test ${Date.now()}-${Math.random()}`,
      email: `audit-${Date.now()}-${Math.random()}@example.com`,
      passwordHash,
      role,
      status,
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createAdminToken = (admin: {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}) => {
  return generateAccessToken({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    status: admin.status,
  });
};

const cleanup = async () => {
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
    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
};

afterEach(async () => {
  await cleanup();
});

describe("Admin User Status Audit Log", () => {
  it("should create an audit log when admin changes user status", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .set("User-Agent", "Vitest-Audit-Test")
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "USER_STATUS_CHANGED",
        entityType: "USER",
        entityId: target.id,
        userId: admin.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    if (!auditLog) {
      throw new Error("Expected audit log was not created");
    }

    createdAuditLogIds.push(auditLog.id);

    expect(auditLog.userId).toBe(admin.id);
    expect(auditLog.entityType).toBe("USER");
    expect(auditLog.entityId).toBe(target.id);
    expect(auditLog.action).toBe("USER_STATUS_CHANGED");

    expect(auditLog.metadata).toEqual({
      previousStatus: "ACTIVE",
      newStatus: "BLOCKED",
    });

    expect(auditLog.description).toContain("ACTIVE");
    expect(auditLog.description).toContain("BLOCKED");

    expect(auditLog.userAgent).toBe("Vitest-Audit-Test");
    expect(auditLog.ipAddress).toBeTruthy();
  });

  it("should not create an audit log when status does not change", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "ACTIVE",
      });

    expect(response.status).toBe(200);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: "USER_STATUS_CHANGED",
        entityType: "USER",
        entityId: target.id,
        userId: admin.id,
      },
    });

    expect(auditLogs).toHaveLength(0);
  });

  it("should create exactly one audit log for a real status transition", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe(UserStatus.BLOCKED);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: admin.id,
        entityType: "USER",
        entityId: target.id,
        action: "USER_STATUS_CHANGED",
      },
    });

    expect(auditLogs).toHaveLength(1);

    const auditLog = auditLogs[0];

    expect(auditLog).toBeDefined();

    if (!auditLog) {
      throw new Error("Expected exactly one audit log");
    }

    createdAuditLogIds.push(auditLog.id);

    expect(auditLog.metadata).toEqual({
      previousStatus: "ACTIVE",
      newStatus: "BLOCKED",
    });
  });

  it("should record BLOCKED to ACTIVE correctly", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.BLOCKED,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "ACTIVE",
      });

    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe(UserStatus.ACTIVE);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: admin.id,
        entityType: "USER",
        entityId: target.id,
        action: "USER_STATUS_CHANGED",
      },
    });

    expect(auditLogs).toHaveLength(1);

    const auditLog = auditLogs[0];

    expect(auditLog).toBeDefined();

    if (!auditLog) {
      throw new Error("Expected exactly one audit log");
    }

    createdAuditLogIds.push(auditLog.id);

    expect(auditLog.metadata).toEqual({
      previousStatus: "BLOCKED",
      newStatus: "ACTIVE",
    });
  });

  it("should record ACTIVE to SUSPENDED correctly", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "SUSPENDED",
      });

    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe(UserStatus.SUSPENDED);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: admin.id,
        entityType: "USER",
        entityId: target.id,
        action: "USER_STATUS_CHANGED",
      },
    });

    expect(auditLog).not.toBeNull();

    if (!auditLog) {
      throw new Error("Expected audit log was not created");
    }

    createdAuditLogIds.push(auditLog.id);

    expect(auditLog.metadata).toEqual({
      previousStatus: "ACTIVE",
      newStatus: "SUSPENDED",
    });
  });

  it("should not create an audit log when the target user does not exist", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const nonexistentUserId =
      "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .patch(`/api/v1/admin/users/${nonexistentUserId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(404);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: admin.id,
        entityType: "USER",
        entityId: nonexistentUserId,
        action: "USER_STATUS_CHANGED",
      },
    });

    expect(auditLogs).toHaveLength(0);
  });

  it("should not create an audit log when the requested status is invalid", async () => {
    const admin = await createUser(
      UserRole.ADMIN,
      UserStatus.ACTIVE,
    );

    const target = await createUser(
      UserRole.CUSTOMER,
      UserStatus.ACTIVE,
    );

    const adminToken = createAdminToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "INVALID_STATUS",
      });

    expect(response.status).toBe(400);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId: admin.id,
        entityType: "USER",
        entityId: target.id,
        action: "USER_STATUS_CHANGED",
      },
    });

    expect(auditLogs).toHaveLength(0);

    const user = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(user?.status).toBe(UserStatus.ACTIVE);
  });
});