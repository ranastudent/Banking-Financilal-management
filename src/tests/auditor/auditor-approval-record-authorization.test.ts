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
      name: `Approval Auditor ${crypto.randomUUID()}`,
      email: `approval-auditor-${crypto.randomUUID()}@example.com`,
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

const createTestCurrency = async () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  let currencyCode = "";

  do {
    currencyCode = Array.from({ length: 3 }, () =>
      letters[Math.floor(Math.random() * letters.length)],
    ).join("");

    const existing =
      await prisma.currency.findUnique({
        where: {
          code: currencyCode,
        },
      });

    if (!existing) {
      break;
    }
  } while (true);

  const currency = await prisma.currency.create({
    data: {
      code: currencyCode,
      name: `Approval Auditor Currency ${currencyCode}`,
      symbol: "T",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
};

const createTestAccount = async (userId: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `99${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestFxRequest = async (
  reviewerId?: string,
) => {
  const customer =
    await createTestUser("CUSTOMER");

  const currency =
    await createTestCurrency();

  const account =
    await createTestAccount(customer.id);

  const fxRequest =
    await prisma.foreignCurrencyRequest.create({
      data: {
        userId: customer.id,
        accountId: account.id,
        requestedCurrency: currency.code,
        requestedAmount:
          new Prisma.Decimal("1000"),
        purposeCategory: "EDUCATION",
        purposeDescription:
          "Auditor approval record test request",
        supportingReference:
          `AUDIT-REF-${crypto.randomUUID()}`,
        status: "APPROVED",
        ...(reviewerId !== undefined && {
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNotes: "Approved during test.",
        }),
      },
    });

  createdRequestIds.push(fxRequest.id);

  return {
    customer,
    currency,
    account,
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
        comment: `Auditor approval record ${decision}`,
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
      jti: `approval-record-${crypto.randomUUID()}`,
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
  "AUDITOR Approval Record Authorization",
  () => {
    it("should allow AUDITOR to view an approval record by ID", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      const approvalRecord =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
        );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/approval-records/${approvalRecord.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.approvalRecord.id,
      ).toBe(approvalRecord.id);

      expect(
        response.body.data.approvalRecord.decision,
      ).toBe("APPROVED");
    });

    it("should allow AUDITOR to list approval records", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      await createTestApprovalRecord(
        fxRequest.id,
        admin.id,
      );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records?page=1&limit=10",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        Array.isArray(
          response.body.data.approvalRecords,
        ),
      ).toBe(true);
    });

    it("should support pagination for a specific request", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      await createTestApprovalRecord(
        fxRequest.id,
        admin.id,
        "APPROVED",
      );

      await createTestApprovalRecord(
        fxRequest.id,
        admin.id,
        "REJECTED",
      );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records?page=1&limit=1",
        )
        .query({
          requestId: fxRequest.id,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      expect(
        response.body.data.approvalRecords,
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

    it("should filter by decision", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      const approved =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
          "APPROVED",
        );

      await createTestApprovalRecord(
        fxRequest.id,
        admin.id,
        "REJECTED",
      );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records",
        )
        .query({
          decision: "APPROVED",
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.approvalRecords.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(approved.id);

      expect(
        response.body.data.approvalRecords.every(
          (item: { decision: string }) =>
            item.decision === "APPROVED",
        ),
      ).toBe(true);
    });

    it("should filter by reviewerId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const otherAdmin =
        await createTestUser("ADMIN");

      const firstRequest =
        await createTestFxRequest(admin.id);

      const secondRequest =
        await createTestFxRequest(
          otherAdmin.id,
        );

      const firstRecord =
        await createTestApprovalRecord(
          firstRequest.fxRequest.id,
          admin.id,
        );

      await createTestApprovalRecord(
        secondRequest.fxRequest.id,
        otherAdmin.id,
      );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records",
        )
        .query({
          reviewerId: admin.id,
          limit: 100,
        })
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const ids =
        response.body.data.approvalRecords.map(
          (item: { id: string }) => item.id,
        );

      expect(ids).toContain(firstRecord.id);

      expect(
        response.body.data.approvalRecords.every(
          (item: { reviewerId: string }) =>
            item.reviewerId === admin.id,
        ),
      ).toBe(true);
    });

    it("should include reviewer safe information", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      const record =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
        );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/approval-records/${record.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const reviewer =
        response.body.data.approvalRecord.reviewer;

      expect(reviewer.id).toBe(admin.id);
      expect(reviewer.email).toBe(admin.email);
      expect(reviewer).not.toHaveProperty(
        "passwordHash",
      );
    });

    it("should include the related FX request safely", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      const record =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
        );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/approval-records/${record.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const requestData =
        response.body.data.approvalRecord
          .request;

      expect(requestData.id).toBe(
        fxRequest.id,
      );

      expect(requestData).not.toHaveProperty(
        "passwordHash",
      );

      expect(requestData).not.toHaveProperty(
        "metadata",
      );
    });

    it("should reject CUSTOMER", async () => {
      const customer =
        await createTestUser("CUSTOMER");

      const token =
        createAccessToken(customer);

      const response = await request(app).get(
        "/api/v1/auditor/approval-records",
      ).set(
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

      const response = await request(app).get(
        "/api/v1/auditor/approval-records",
      ).set(
        "Authorization",
        `Bearer ${token}`,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject SUPPORT", async () => {
      const support =
        await createTestUser("SUPPORT");

      const token =
        createAccessToken(support);

      const response = await request(app).get(
        "/api/v1/auditor/approval-records",
      ).set(
        "Authorization",
        `Bearer ${token}`,
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/approval-records",
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
          "/api/v1/auditor/approval-records",
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

    it("should return 404 for a nonexistent approval record", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records/00000000-0000-0000-0000-000000000000",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(404);
      expect(
        response.body.error.code,
      ).toBe("RESOURCE_NOT_FOUND");
    });

    it("should reject an invalid approval record ID", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records/not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject an invalid reviewerId filter", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records?reviewerId=not-a-uuid",
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(400);
    });

    it("should reject an invalid requestId filter", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records?requestId=not-a-uuid",
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
          "/api/v1/auditor/approval-records?page=0&limit=101",
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

      const admin =
        await createTestUser("ADMIN");

      const { fxRequest } =
        await createTestFxRequest(admin.id);

      const record =
        await createTestApprovalRecord(
          fxRequest.id,
          admin.id,
        );

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/auditor/approval-records/${record.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(response.status).toBe(200);

      const approvalRecord =
        response.body.data.approvalRecord;

      expect(approvalRecord).not.toHaveProperty(
        "passwordHash",
      );

      expect(approvalRecord).not.toHaveProperty(
        "accessToken",
      );

      expect(approvalRecord).not.toHaveProperty(
        "refreshToken",
      );

      expect(
        approvalRecord.reviewer,
      ).not.toHaveProperty("passwordHash");
    });

    it("should include requestId", async () => {
      const auditor =
        await createTestUser("AUDITOR");

      const token =
        createAccessToken(auditor);

      const response = await request(app)
        .get(
          "/api/v1/auditor/approval-records",
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
    });
  },
);