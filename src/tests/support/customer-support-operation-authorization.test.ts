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
      name: `Support Operation ${role} ${crypto.randomUUID()}`,
      email: `support-operation-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
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
      jti: `support-operation-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  /*
   * AuditLog references User through userId,
   * therefore remove audit records first.
   */
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
  "SUPPORT Customer Support Operations Authorization",
  () => {
    it("should allow SUPPORT to record account inquiry", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "ACCOUNT_INQUIRY",
          description:
            "Customer requested account information.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.customer.id,
      ).toBe(customer.id);

      expect(
        response.body.data.supportOperation.action,
      ).toBe("SUPPORT_CUSTOMER_OPERATION");

      expect(
        response.body.data.supportOperation.entityType,
      ).toBe("CUSTOMER");

      expect(
        response.body.data.supportOperation.entityId,
      ).toBe(customer.id);
    });

    it("should allow SUPPORT to record transaction inquiry", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "TRANSACTION_INQUIRY",
          description:
            "Customer requested clarification about a transaction.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.supportOperation.metadata
          .operationType,
      ).toBe("TRANSACTION_INQUIRY");
    });

    it("should allow beneficiary assistance operation", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "BENEFICIARY_ASSISTANCE",
          description:
            "Customer received assistance regarding a beneficiary.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("should allow general support operation", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description:
            "Customer received general assistance.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("should create an audit trail record", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Customer requested support.",
        });

      expect(response.status).toBe(201);

      const auditLog =
        await prisma.auditLog.findUnique({
          where: {
            id:
              response.body.data.supportOperation.id,
          },
        });

      expect(auditLog).not.toBeNull();

      if (auditLog) {
        createdAuditLogIds.push(auditLog.id);
      }

      expect(auditLog?.userId).toBe(support.id);
      expect(auditLog?.entityType).toBe("CUSTOMER");
      expect(auditLog?.entityId).toBe(customer.id);
      expect(auditLog?.action).toBe(
        "SUPPORT_CUSTOMER_OPERATION",
      );
    });

    it("should reject ADMIN", async () => {
      const admin = await createUser("ADMIN");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(admin);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Unauthorized operation.",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject CUSTOMER", async () => {
      const customer = await createUser("CUSTOMER");
      const target = await createUser("CUSTOMER");

      const token = createAccessToken(customer);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${target.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Unauthorized operation.",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject AUDITOR", async () => {
      const auditor = await createUser("AUDITOR");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Unauthorized operation.",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const customer = await createUser("CUSTOMER");

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Unauthorized operation.",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const refreshToken =
        createRefreshToken(support.id);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set(
          "Authorization",
          `Bearer ${refreshToken}`,
        )
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Unauthorized operation.",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a non-customer target", async () => {
      const support = await createUser("SUPPORT");
      const admin = await createUser("ADMIN");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${admin.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Should not be recorded.",
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject an invalid customer ID", async () => {
      const support = await createUser("SUPPORT");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          "/api/v1/support/customers/not-a-uuid/support-operations",
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Invalid customer ID.",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject an invalid operation type", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "DELETE_CUSTOMER",
          description: "Invalid operation.",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject a short description", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "x",
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject an excessively long description", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "x".repeat(1001),
        });

      expect(response.status).toBe(413);
      expect(response.body.success).toBe(false);
    });

    it("should not modify the customer record", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const before =
        await prisma.user.findUnique({
          where: {
            id: customer.id,
          },
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Customer received support.",
        });

      expect(response.status).toBe(201);

      const after =
        await prisma.user.findUnique({
          where: {
            id: customer.id,
          },
        });

      expect(after).not.toBeNull();
      expect(before).not.toBeNull();

      expect(after?.name).toBe(before?.name);
      expect(after?.email).toBe(before?.email);
      expect(after?.role).toBe("CUSTOMER");
      expect(after?.status).toBe("ACTIVE");
    });

    it("should include requestId", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Customer received support.",
        });

      expect(response.status).toBe(201);
      expect(response.body.requestId).toBeDefined();
      expect(
        typeof response.body.requestId,
      ).toBe("string");

      const auditLogId =
        response.body.data.supportOperation.id;

      createdAuditLogIds.push(auditLogId);
    });

    it("should not expose passwords or tokens", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .post(
          `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
          operationType: "GENERAL_SUPPORT",
          description: "Customer received support.",
        });

      expect(response.status).toBe(201);

      const data = response.body.data;

      expect(data).not.toHaveProperty("password");
      expect(data).not.toHaveProperty("passwordHash");
      expect(data).not.toHaveProperty("accessToken");
      expect(data).not.toHaveProperty("refreshToken");

      expect(data.customer).not.toHaveProperty(
        "password",
      );

      expect(data.customer).not.toHaveProperty(
        "passwordHash",
      );

      expect(data.supportOperation).not.toHaveProperty(
        "passwordHash",
      );

      createdAuditLogIds.push(
        data.supportOperation.id,
      );
    });

    it("should not change customer financial records", async () => {
    const support = await createUser("SUPPORT");
    const customer = await createUser("CUSTOMER");

    const beforeAccounts =
        await prisma.account.findMany({
        where: {
            userId: customer.id,
        },
        select: {
            id: true,
            status: true,
        },
        });

    const beforeTransactions =
        await prisma.transaction.findMany({
        where: {
            OR: [
            {
                sourceAccount: {
                userId: customer.id,
                },
            },
            {
                destinationAccount: {
                userId: customer.id,
                },
            },
            ],
        },
        select: {
            id: true,
            status: true,
        },
        });

    const token = createAccessToken(support);

    const response = await request(app)
        .post(
        `/api/v1/support/customers/${customer.id}/support-operations`,
        )
        .set("Authorization", `Bearer ${token}`)
        .send({
        operationType: "ACCOUNT_INQUIRY",
        description:
            "Customer requested account assistance.",
        });

    expect(response.status).toBe(201);

    const afterAccounts =
        await prisma.account.findMany({
        where: {
            userId: customer.id,
        },
        select: {
            id: true,
            status: true,
        },
        });

    const afterTransactions =
        await prisma.transaction.findMany({
        where: {
            OR: [
            {
                sourceAccount: {
                userId: customer.id,
                },
            },
            {
                destinationAccount: {
                userId: customer.id,
                },
            },
            ],
        },
        select: {
            id: true,
            status: true,
        },
        });

    expect(afterAccounts).toEqual(beforeAccounts);
    expect(afterTransactions).toEqual(
        beforeTransactions,
    );

    createdAuditLogIds.push(
        response.body.data.supportOperation.id,
    );
        });
  },
);