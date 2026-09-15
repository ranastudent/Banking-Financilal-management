import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdAccountIds: string[] = [];
const createdRequestIds: string[] = [];
const createdApprovalRecordIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `FX Auditor ${crypto.randomUUID()}`,
      email: `fx-auditor-${crypto.randomUUID()}@example.com`,
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

const createTestCurrency = async (
  preferredCode = "ZZZ",
) => {
  let currencyCode = preferredCode;

  const existing =
    await prisma.currency.findUnique({
      where: {
        code: currencyCode,
      },
    });

  if (existing) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    do {
      currencyCode = Array.from(
        { length: 3 },
        () =>
          letters[
            Math.floor(
              Math.random() * letters.length,
            )
          ],
      ).join("");

      const conflict =
        await prisma.currency.findUnique({
          where: {
            code: currencyCode,
          },
        });

      if (!conflict) {
        break;
      }
    } while (true);
  }

  const currency = await prisma.currency.create({
    data: {
      code: currencyCode,
      name: `FX Auditor ${currencyCode}`,
      symbol: "$",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
};

const createTestAccount = async (
  userId: string,
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `FX${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestFxRequest = async (data?: {
  userId?: string;
  accountId?: string;
  currencyCode?: string;
  status?:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "NEEDS_MORE_INFORMATION"
    | "EXPIRED"
    | "CANCELLED";
  reviewedBy?: string;
}) => {
  let user;

  if (data?.userId) {
    user =
      await prisma.user.findUniqueOrThrow({
        where: {
          id: data.userId,
        },
      });
  } else {
    user = await createTestUser("CUSTOMER");
  }

  const account = data?.accountId
    ? await prisma.account.findUniqueOrThrow({
        where: {
          id: data.accountId,
        },
      })
    : await createTestAccount(user.id);

  const currency = data?.currencyCode
    ? await prisma.currency.findUniqueOrThrow({
        where: {
          code: data.currencyCode,
        },
      })
    : await createTestCurrency();

  const status = data?.status ?? "PENDING";

  const fxRequest =
    await prisma.foreignCurrencyRequest.create({
      data: {
        userId: user.id,
        accountId: account.id,
        requestedCurrency: currency.code,
        requestedAmount:
          new Prisma.Decimal("1000"),
        purposeCategory: "EDUCATION",
        purposeDescription:
          "Auditor FX request history test",
        supportingReference:
          `FX-HISTORY-${crypto.randomUUID()}`,
        status,
        ...(data?.reviewedBy !== undefined && {
          reviewedBy: data.reviewedBy,
          reviewedAt: new Date(),
          reviewNotes:
            "Reviewed during test.",
        }),
      },
    });

  createdRequestIds.push(fxRequest.id);

  return {
    user,
    account,
    currency,
    fxRequest,
  };
};

const createTestApprovalRecord = async (
  requestId: string,
  reviewerId: string,
  decision:
    | "APPROVED"
    | "REJECTED"
    | "NEEDS_MORE_INFORMATION" = "APPROVED",
) => {
  const record =
    await prisma.approvalRecord.create({
      data: {
        requestId,
        reviewerId,
        decision,
        comment: `FX history ${decision}`,
      },
    });

  createdApprovalRecordIds.push(record.id);

  return record;
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
      jti: `fx-history-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdApprovalRecordIds.length > 0) {
    await prisma.approvalRecord.deleteMany({
      where: {
        id: {
          in: [...createdApprovalRecordIds],
        },
      },
    });

    createdApprovalRecordIds.length = 0;
  }

  if (createdRequestIds.length > 0) {
    await prisma.foreignCurrencyRequest.deleteMany({
      where: {
        id: {
          in: [...createdRequestIds],
        },
      },
    });

    createdRequestIds.length = 0;
  }

  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: {
          in: [...createdAccountIds],
        },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: {
          in: [...createdAccountIds],
        },
      },
    });

    createdAccountIds.length = 0;
  }

  if (createdCurrencyCodes.length > 0) {
    await prisma.currency.deleteMany({
      where: {
        code: {
          in: [...createdCurrencyCodes],
        },
      },
    });

    createdCurrencyCodes.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [...createdUserIds],
        },
      },
    });

    createdUserIds.length = 0;
  }
});

describe(
  "AUDITOR FX Request History Authorization",
  () => {
    it("should allow AUDITOR to view an FX request by ID", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const { fxRequest } =
        await createTestFxRequest({
          status: "APPROVED",
        });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/fx-requests/${fxRequest.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.fxRequest.id,
      ).toBe(fxRequest.id);

      expect(
        response.body.data.fxRequest.status,
      ).toBe("APPROVED");
    });

    it("should allow AUDITOR to list FX requests", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      await createTestFxRequest({
        status: "PENDING",
      });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?page=1&limit=10",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        Array.isArray(
          response.body.data.fxRequests,
        ),
      ).toBe(true);
    });

    it("should support pagination for a specific customer", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      await createTestFxRequest({
        userId: customer.id,
      });

      await createTestFxRequest({
        userId: customer.id,
      });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?page=1&limit=1",
        )
        .query({
          userId: customer.id,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      expect(
        response.body.data.fxRequests,
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

    it("should filter by status", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const approved =
        await createTestFxRequest({
          status: "APPROVED",
        });

      await createTestFxRequest({
        status: "REJECTED",
      });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .query({
          status: "APPROVED",
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.fxRequests.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(
        approved.fxRequest.id,
      );

      expect(
        response.body.data.fxRequests.every(
          (item: { status: string }) =>
            item.status === "APPROVED",
        ),
      ).toBe(true);
    });

    it("should filter by customer userId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const otherCustomer =
        await createTestUser("CUSTOMER");

      const customerRequest =
        await createTestFxRequest({
          userId: customer.id,
        });

      const otherRequest =
        await createTestFxRequest({
          userId: otherCustomer.id,
        });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .query({
          userId: customer.id,
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.fxRequests.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(
        customerRequest.fxRequest.id,
      );

      expect(ids).not.toContain(
        otherRequest.fxRequest.id,
      );
    });

    it("should filter by accountId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const customer =
        await createTestUser("CUSTOMER");

      const account =
        await createTestAccount(customer.id);

      const requestForAccount =
        await createTestFxRequest({
          userId: customer.id,
          accountId: account.id,
        });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .query({
          accountId: account.id,
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.fxRequests.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(
        requestForAccount.fxRequest.id,
      );
    });

    it("should filter by requested currency", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const currency =
        await createTestCurrency();

      const matching =
        await createTestFxRequest({
          currencyCode: currency.code,
        });

      const otherCurrency =
        await createTestCurrency();

      const nonMatching =
        await createTestFxRequest({
          currencyCode: otherCurrency.code,
        });

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .query({
          requestedCurrency: currency.code,
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.fxRequests.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(
        matching.fxRequest.id,
      );

      expect(ids).not.toContain(
        nonMatching.fxRequest.id,
      );
    });

    it("should include related approval history", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest({
          status: "APPROVED",
          reviewedBy: admin.id,
        });

      const approval =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
          "APPROVED",
        );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/fx-requests/${fxRequest.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const records =
        response.body.data.fxRequest
          .approvalRecords;

      expect(
        records.some(
          (item: { id: string }) =>
            item.id === approval.id,
        ),
      ).toBe(true);
    });

    it("should include safe customer information", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const { fxRequest, user } =
        await createTestFxRequest();

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/fx-requests/${fxRequest.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const customer =
        response.body.data.fxRequest.user;

      expect(customer.id).toBe(user.id);
      expect(customer.email).toBe(user.email);

      expect(customer).not.toHaveProperty(
        "passwordHash",
      );
    });

    it("should reject CUSTOMER", async () => {
      const customer =
        await createTestUser("CUSTOMER");

      const token =
        createAccessToken(customer);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN", async () => {
      const admin =
        await createTestUser("ADMIN");

      const token =
        createAccessToken(admin);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
    });

    it("should reject SUPPORT", async () => {
      const support =
        await createTestUser("SUPPORT");

      const token =
        createAccessToken(support);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/fx-requests",
      );

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const refreshToken =
        createRefreshToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
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

    it("should return 404 for a nonexistent FX request", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests/00000000-0000-0000-0000-000000000000",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject an invalid FX request ID", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests/not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject an invalid userId filter", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?userId=not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject an invalid accountId filter", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?accountId=not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject an invalid currency code", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?requestedCurrency=US",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject invalid pagination", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests?page=0&limit=101",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should not expose authentication secrets", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const { fxRequest } =
        await createTestFxRequest();

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/fx-requests/${fxRequest.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const data =
        response.body.data.fxRequest;

      expect(data).not.toHaveProperty(
        "passwordHash",
      );

      expect(data).not.toHaveProperty(
        "accessToken",
      );

      expect(data).not.toHaveProperty(
        "refreshToken",
      );

      expect(data.user).not.toHaveProperty(
        "passwordHash",
      );

      if(data.reviewer !== null) {
        expect(data.reviewer).not.toHaveProperty(
          "passwordHash",
        );
      }

    });

    it("should include requestId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/fx-requests",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

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