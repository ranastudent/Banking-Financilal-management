import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";

describe("Audit service", () => {
  let userId: string | undefined;
  const auditLogIds: string[] = [];

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Audit Test User",
        email: `audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        passwordHash: "test-only-hash",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

    userId = user.id;
    auditLogIds.length = 0;
  });

  afterEach(async () => {
    if (auditLogIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { id: { in: auditLogIds } },
      });
    }

    if (userId) {
      await prisma.user.deleteMany({
        where: { id: userId },
      });
      userId = undefined;
    }
  });

  it("persists structured audit context and operation details", async () => {
    const audit = await writeAuditLog({
      userId: userId ?? null,
      action: "ACCOUNT_CREATED",
      resource: "ACCOUNT",
      resourceId: "account-test-id",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      requestId: "audit-request-123",
      metadata: { accountType: "SAVINGS", currency: "BDT" },
    });

    auditLogIds.push(audit.id);

    expect(audit.userId).toBe(userId);
    expect(audit.action).toBe("ACCOUNT_CREATED");
    expect(audit.entityType).toBe("ACCOUNT");
    expect(audit.entityId).toBe("account-test-id");
    expect(audit.ipAddress).toBe("127.0.0.1");
    expect(audit.userAgent).toBe("vitest");
    expect(audit.requestId).toBe("audit-request-123");
    expect(audit.success).toBe(true);
    expect(audit.createdAt).toBeInstanceOf(Date);
    expect(audit.metadata).toEqual({
      accountType: "SAVINGS",
      currency: "BDT",
    });
  });

  it("redacts credentials and tokens from metadata", async () => {
    const audit = await writeAuditLog({
      userId: userId ?? null,
      action: "SECURITY_ALERT",
      resource: "USER",
      resourceId: userId ?? null,
      success: false,
      failureReason: "Invalid credentials",
      metadata: {
        reason: "INVALID_CREDENTIALS",
        password: "never-store-this",
        accessToken: "secret-token",
        otp: "123456",
      },
    });

    auditLogIds.push(audit.id);

    expect(audit.metadata).toEqual({
      reason: "INVALID_CREDENTIALS",
      password: "[REDACTED]",
      accessToken: "[REDACTED]",
      otp: "[REDACTED]",
    });
    expect(audit.success).toBe(false);
    expect(audit.failureReason).toBe("Invalid credentials");
  });

  it("rolls back audit records with the surrounding business transaction", async () => {
    const requestId = `audit-rollback-${Date.now()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await writeAuditLog(
          {
            userId: userId ?? null,
            action: "TEST_ROLLBACK",
            resource: "TEST",
            requestId,
          },
          tx,
        );

        throw new Error("force transaction rollback");
      }),
    ).rejects.toThrow("force transaction rollback");

    const persisted = await prisma.auditLog.findFirst({
      where: { requestId },
      select: { id: true },
    });

    expect(persisted).toBeNull();
  });
});
