import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdTransactionIds: string[] = [];
const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Auditor Account ${crypto.randomUUID()}`,
      email: `auditor-account-${crypto.randomUUID()}@example.com`,
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

const createTestAccount = async (
  userId: string,
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `AAC-${Date.now()}-${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestTransaction = async (data: {
  sourceAccountId?: string;
  destinationAccountId?: string;
}) => {
  const transaction =
    await prisma.transaction.create({
      data: {
        reference: `AAC-TX-${crypto.randomUUID()}`,
        type: "INTERNAL_TRANSFER",
        status: "COMPLETED",
        amount: "1000.00",
        currencyCode: "BDT",
        provider: "INTERNAL",

        ...(data.sourceAccountId !== undefined && {
          sourceAccountId: data.sourceAccountId,
        }),

        ...(data.destinationAccountId !== undefined && {
          destinationAccountId:
            data.destinationAccountId,
        }),
      },
    });

  createdTransactionIds.push(transaction.id);

  return transaction;
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
      jti: `auditor-account-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    const ids = [...createdTransactionIds];
    createdTransactionIds.length = 0;

    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  if (createdAccountIds.length > 0) {
    const ids = [...createdAccountIds];
    createdAccountIds.length = 0;

    await prisma.account.deleteMany({
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
  "AUDITOR Account Activity Authorization",
  () => {
    it("should allow AUDITOR to view account activity", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const transaction =
        await createTestTransaction({
          destinationAccountId: account.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        response.body.data.account.id,
      ).toBe(account.id);

      const ids =
        response.body.data.activity.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(transaction.id);
    });

    it("should include account owner safe information", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(
        response.body.data.account.user.id,
      ).toBe(customer.id);

      expect(
        response.body.data.account.user.email,
      ).toBe(customer.email);

      expect(
        response.body.data.account.user,
      ).not.toHaveProperty("passwordHash");
    });

    it("should include incoming account activity", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const owner =
        await createTestUser("CUSTOMER");

      const sender =
        await createTestUser("CUSTOMER");

      const ownerAccount =
        await createTestAccount(owner.id);

      const senderAccount =
        await createTestAccount(sender.id);

      const transaction =
        await createTestTransaction({
          sourceAccountId: senderAccount.id,
          destinationAccountId:
            ownerAccount.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${ownerAccount.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.activity.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(transaction.id);
    });

    it("should include outgoing account activity", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const owner =
        await createTestUser("CUSTOMER");

      const receiver =
        await createTestUser("CUSTOMER");

      const ownerAccount =
        await createTestAccount(owner.id);

      const receiverAccount =
        await createTestAccount(receiver.id);

      const transaction =
        await createTestTransaction({
          sourceAccountId: ownerAccount.id,
          destinationAccountId:
            receiverAccount.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${ownerAccount.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.activity.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(transaction.id);
    });

    it("should not include unrelated account activity", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const owner =
        await createTestUser("CUSTOMER");

      const other =
        await createTestUser("CUSTOMER");

      const ownerAccount =
        await createTestAccount(owner.id);

      const otherAccount =
        await createTestAccount(other.id);

      const transaction =
        await createTestTransaction({
          sourceAccountId: otherAccount.id,
          destinationAccountId:
            otherAccount.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${ownerAccount.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.activity.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).not.toContain(transaction.id);
    });

    it("should support pagination", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      await createTestTransaction({
        destinationAccountId: account.id,
      });

      await createTestTransaction({
        destinationAccountId: account.id,
      });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity?page=1&limit=1`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(
        response.body.data.activity.transactions,
      ).toHaveLength(1);

      expect(
        response.body.data.activity.pagination.page,
      ).toBe(1);

      expect(
        response.body.data.activity.pagination.limit,
      ).toBe(1);

      expect(
        response.body.data.activity.pagination.total,
      ).toBe(2);

      expect(
        response.body.data.activity.pagination.totalPages,
      ).toBe(2);
    });

    it("should reject CUSTOMER", async () => {
      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(customer);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN", async () => {
      const admin =
        await createTestUser("ADMIN");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(admin);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it("should reject SUPPORT", async () => {
      const support =
        await createTestUser("SUPPORT");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/accounts/00000000-0000-0000-0000-000000000000/activity",
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const account =
        await createTestAccount(auditor.id);

      const refreshToken =
        createRefreshToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set(
          "Authorization",
          `Bearer ${refreshToken}`,
        );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should return 404 for nonexistent account", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/accounts/00000000-0000-0000-0000-000000000000/activity",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject invalid account ID", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/accounts/not-a-uuid/activity",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it("should reject invalid pagination", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/accounts/00000000-0000-0000-0000-000000000000/activity?page=0&limit=101",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it("should not expose transaction metadata", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      await createTestTransaction({
        destinationAccountId: account.id,
      });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const transaction =
        response.body.data.activity.transactions[0];

      expect(transaction).not.toHaveProperty(
        "metadata",
      );

      expect(transaction).not.toHaveProperty(
        "passwordHash",
      );

      expect(transaction).not.toHaveProperty(
        "accessToken",
      );

      expect(transaction).not.toHaveProperty(
        "refreshToken",
      );
    });

    it("should include account balances", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(
        Array.isArray(
          response.body.data.account.balances,
        ),
      ).toBe(true);
    });

    it("should return an empty activity list when the account has no transactions", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(
        response.body.data.activity.transactions,
      ).toEqual([]);

      expect(
        response.body.data.activity.pagination.total,
      ).toBe(0);

      expect(
        response.body.data.activity.pagination.totalPages,
      ).toBe(0);
    });

    it("should include requestId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/accounts/${account.id}/activity`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      expect(typeof response.body.requestId).toBe(
        "string",
      );
      expect(
        response.body.requestId.length,
      ).toBeGreaterThan(0);
    });
  },
);