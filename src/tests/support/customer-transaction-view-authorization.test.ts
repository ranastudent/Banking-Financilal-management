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

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  name = `Support Transaction ${crypto.randomUUID()}`,
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email: `support-transaction-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
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

const createAccount = async (userId: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `STX-${Date.now()}-${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTransaction = async (data: {
  sourceAccountId?: string;
  destinationAccountId?: string;
  status?:
    | "PENDING"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED"
    | "REFUNDED";
  type?:
    | "DEPOSIT"
    | "WITHDRAWAL"
    | "INTERNAL_TRANSFER"
    | "EXTERNAL_DEPOSIT"
    | "EXTERNAL_TRANSFER"
    | "FX_CONVERSION"
    | "REFUND";
  provider?:
    | "INTERNAL"
    | "BKASH"
    | "NAGAD"
    | "ROCKET"
    | "PAYPAL"
    | "PAYONEER"
    | "WISE";
}) => {
  const transaction =
    await prisma.transaction.create({
      data: {
        reference: `STX-${Date.now()}-${crypto.randomUUID()}`,
        type: data.type ?? "INTERNAL_TRANSFER",
        status: data.status ?? "COMPLETED",
        amount: "100.00",
        currencyCode: "BDT",
        provider: data.provider ?? "INTERNAL",

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

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: `support-tx-${crypto.randomUUID()}`,
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
  "SUPPORT Customer Transaction View Authorization",
  () => {
    it("should allow SUPPORT to view customer transactions", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");
      const customerAccount =
        await createAccount(customer.id);

      const transaction = await createTransaction({
        sourceAccountId: customerAccount.id,
      });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.transactions.some(
          (item: { id: string }) =>
            item.id === transaction.id,
        ),
      ).toBe(true);
    });

    it("should include transactions where customer is the destination", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");
      const otherCustomer =
        await createUser("CUSTOMER");

      const customerAccount =
        await createAccount(customer.id);

      const otherAccount =
        await createAccount(otherCustomer.id);

      const transaction = await createTransaction({
        sourceAccountId: otherAccount.id,
        destinationAccountId: customerAccount.id,
      });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      expect(
        response.body.data.transactions.some(
          (item: { id: string }) =>
            item.id === transaction.id,
        ),
      ).toBe(true);
    });

    it("should not return transactions belonging only to another customer", async () => {
      const support = await createUser("SUPPORT");
      const customer =
        await createUser("CUSTOMER");

      const otherCustomer =
        await createUser("CUSTOMER");

      const customerAccount =
        await createAccount(customer.id);

      const otherAccount =
        await createAccount(otherCustomer.id);

      const unrelatedTransaction =
        await createTransaction({
          sourceAccountId: otherAccount.id,
        });

      const relatedTransaction =
        await createTransaction({
          sourceAccountId: customerAccount.id,
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(relatedTransaction.id);
      expect(ids).not.toContain(
        unrelatedTransaction.id,
      );
    });

    it("should filter by transaction status", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      const completed =
        await createTransaction({
          sourceAccountId: account.id,
          status: "COMPLETED",
        });

      const failed =
        await createTransaction({
          sourceAccountId: account.id,
          status: "FAILED",
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .query({
          status: "COMPLETED",
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(completed.id);
      expect(ids).not.toContain(failed.id);
    });

    it("should filter by transaction type", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      const transfer =
        await createTransaction({
          sourceAccountId: account.id,
          type: "INTERNAL_TRANSFER",
        });

      const withdrawal =
        await createTransaction({
          sourceAccountId: account.id,
          type: "WITHDRAWAL",
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .query({
          type: "WITHDRAWAL",
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(withdrawal.id);
      expect(ids).not.toContain(transfer.id);
    });

    it("should filter by provider", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      const internal =
        await createTransaction({
          sourceAccountId: account.id,
          provider: "INTERNAL",
        });

      const bkash =
        await createTransaction({
          sourceAccountId: account.id,
          provider: "BKASH",
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .query({
          provider: "BKASH",
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(bkash.id);
      expect(ids).not.toContain(internal.id);
    });

    it("should support pagination", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      await createTransaction({
        sourceAccountId: account.id,
      });

      await createTransaction({
        sourceAccountId: account.id,
      });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .query({
          page: 1,
          limit: 1,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(
        response.body.data.transactions,
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

    it("should return 404 for a non-customer user", async () => {
      const support = await createUser("SUPPORT");
      const admin = await createUser("ADMIN");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${admin.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should return 404 for a nonexistent customer", async () => {
      const support = await createUser("SUPPORT");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          "/api/v1/support/customers/00000000-0000-0000-0000-000000000000/transactions",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject invalid customer ID", async () => {
      const support = await createUser("SUPPORT");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          "/api/v1/support/customers/not-a-uuid/transactions",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject invalid transaction status filter", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .query({
          status: "UNKNOWN",
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject CUSTOMER access", async () => {
      const customer = await createUser("CUSTOMER");
      const target = await createUser("CUSTOMER");

      const token = createAccessToken(customer);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${target.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN access", async () => {
      const admin = await createUser("ADMIN");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(admin);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject AUDITOR access", async () => {
      const auditor = await createUser("AUDITOR");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const customer = await createUser("CUSTOMER");

      const response = await request(app).get(
        `/api/v1/support/customers/${customer.id}/transactions`,
      );

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
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
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

    it("should not expose sensitive authentication fields", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      await createTransaction({
        sourceAccountId: account.id,
      });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const transaction =
        response.body.data.transactions[0];

      expect(transaction).not.toHaveProperty(
        "password",
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

      expect(transaction).not.toHaveProperty(
        "metadata",
      );
    });

    it("should include requestId", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      expect(
        typeof response.body.requestId,
      ).toBe("string");
    });

    it("should be read-only", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      const transaction = await createTransaction({
        sourceAccountId: account.id,
      });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/transactions`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const databaseTransaction =
        await prisma.transaction.findUnique({
          where: {
            id: transaction.id,
          },
        });

      expect(databaseTransaction).not.toBeNull();

      expect(databaseTransaction?.status).toBe(
        "COMPLETED",
      );

      expect(databaseTransaction?.amount.toString()).toBe(
        "100",
      );
    });
  },
);