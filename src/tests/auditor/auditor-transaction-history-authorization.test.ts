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
      name: `Auditor Transaction ${crypto.randomUUID()}`,
      email: `auditor-tx-${crypto.randomUUID()}@example.com`,
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
      accountNumber: `ATX-${Date.now()}-${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestTransaction = async (data?: {
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
  currencyCode?: string;
}) => {
  const transaction =
    await prisma.transaction.create({
      data: {
        reference: `ATX-${Date.now()}-${crypto.randomUUID()}`,
        type: data?.type ?? "DEPOSIT",
        status: data?.status ?? "COMPLETED",
        amount: "1000.00",
        currencyCode: data?.currencyCode ?? "BDT",
        provider: data?.provider ?? "INTERNAL",

        ...(data?.sourceAccountId !== undefined && {
          sourceAccountId: data.sourceAccountId,
        }),

        ...(data?.destinationAccountId !== undefined && {
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
      jti: `auditor-tx-${crypto.randomUUID()}`,
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
  "AUDITOR Transaction History Authorization",
  () => {
    it("should allow AUDITOR to view a transaction by ID", async () => {
      const auditor = await createTestUser("AUDITOR");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        response.body.data.transaction.id,
      ).toBe(transaction.id);
      expect(
        response.body.data.transaction.reference,
      ).toBe(transaction.reference);
    });

    it("should allow AUDITOR to list transactions", async () => {
      const auditor = await createTestUser("AUDITOR");

      await createTestTransaction();
      await createTestTransaction();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions?page=1&limit=10",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(
        Array.isArray(
          response.body.data.transactions,
        ),
      ).toBe(true);
    });

    it("should support pagination", async () => {
      const auditor = await createTestUser("AUDITOR");

      await createTestTransaction({
        status: "COMPLETED",
      });
      await createTestTransaction({
        status: "COMPLETED",
      });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions?page=1&limit=1",
        )
        .query({
          provider: "INTERNAL",
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
    });

    it("should filter by transaction status", async () => {
      const auditor = await createTestUser("AUDITOR");

      const completed =
        await createTestTransaction({
          status: "COMPLETED",
        });

      const failed =
        await createTestTransaction({
          status: "FAILED",
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          status: "FAILED",
          limit: 100,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(failed.id);
      expect(ids).not.toContain(completed.id);
    });

    it("should filter by transaction type", async () => {
      const auditor = await createTestUser("AUDITOR");

      const deposit =
        await createTestTransaction({
          type: "DEPOSIT",
        });

      const withdrawal =
        await createTestTransaction({
          type: "WITHDRAWAL",
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          type: "WITHDRAWAL",
          limit: 100,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(withdrawal.id);
      expect(ids).not.toContain(deposit.id);
    });

    it("should filter by provider", async () => {
      const auditor = await createTestUser("AUDITOR");

      const internal =
        await createTestTransaction({
          provider: "INTERNAL",
        });

      const bkash =
        await createTestTransaction({
          provider: "BKASH",
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          provider: "BKASH",
          limit: 100,
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

    it("should filter by currency", async () => {
      const auditor = await createTestUser("AUDITOR");

      const bdt =
        await createTestTransaction({
          currencyCode: "BDT",
        });

      const usd =
        await createTestTransaction({
          currencyCode: "USD",
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          currencyCode: "USD",
          limit: 100,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(usd.id);
      expect(ids).not.toContain(bdt.id);
    });

    it("should filter by customer userId", async () => {
      const auditor = await createTestUser("AUDITOR");
      const customer = await createTestUser("CUSTOMER");
      const otherCustomer =
        await createTestUser("CUSTOMER");

      const customerAccount =
        await createTestAccount(customer.id);

      const otherAccount =
        await createTestAccount(otherCustomer.id);

      const related =
        await createTestTransaction({
          sourceAccountId: customerAccount.id,
        });

      const unrelated =
        await createTestTransaction({
          sourceAccountId: otherAccount.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          userId: customer.id,
          limit: 100,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(related.id);
      expect(ids).not.toContain(unrelated.id);
    });

    it("should include transactions where the customer is destination", async () => {
      const auditor = await createTestUser("AUDITOR");
      const customer = await createTestUser("CUSTOMER");
      const otherCustomer =
        await createTestUser("CUSTOMER");

      const customerAccount =
        await createTestAccount(customer.id);

      const otherAccount =
        await createTestAccount(otherCustomer.id);

      const transaction =
        await createTestTransaction({
          sourceAccountId: otherAccount.id,
          destinationAccountId:
            customerAccount.id,
        });

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get("/api/v1/auditor/transactions")
        .query({
          userId: customer.id,
          limit: 100,
        })
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const ids =
        response.body.data.transactions.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(transaction.id);
    });

    it("should reject CUSTOMER", async () => {
      const customer = await createTestUser("CUSTOMER");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(customer);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN", async () => {
      const admin = await createTestUser("ADMIN");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(admin);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject SUPPORT", async () => {
      const support = await createTestUser("SUPPORT");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/transactions",
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const auditor = await createTestUser("AUDITOR");
      const refreshToken =
        createRefreshToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions",
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

    it("should return 404 for a nonexistent transaction", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions/00000000-0000-0000-0000-000000000000",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject an invalid transaction ID", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions/not-a-uuid",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it("should reject an invalid userId filter", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions?userId=not-a-uuid",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it("should reject invalid pagination", async () => {
      const auditor = await createTestUser("AUDITOR");

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/transactions?page=0&limit=101",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
    });

    it("should not expose sensitive authentication data", async () => {
      const auditor = await createTestUser("AUDITOR");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const returnedTransaction =
        response.body.data.transaction;

      expect(returnedTransaction).not.toHaveProperty(
        "metadata",
      );

      expect(returnedTransaction).not.toHaveProperty(
        "passwordHash",
      );

      expect(returnedTransaction).not.toHaveProperty(
        "accessToken",
      );

      expect(returnedTransaction).not.toHaveProperty(
        "refreshToken",
      );
    });

    it("should include requestId", async () => {
      const auditor = await createTestUser("AUDITOR");
      const transaction =
        await createTestTransaction();

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/transactions/${transaction.id}`,
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