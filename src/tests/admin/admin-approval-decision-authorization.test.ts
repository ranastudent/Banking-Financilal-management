import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdAccountIds: string[] = [];
const createdRequestIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Approval Test ${Date.now()}-${Math.random()}`,
      email: `approval-${Date.now()}-${Math.random()}@example.com`,
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`,
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

    const existing = await prisma.currency.findUnique({
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
      name: `Approval Test Currency ${currencyCode}`,
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
      accountNumber: `88${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestFxRequest = async () => {
  const customer = await createTestUser("CUSTOMER");
  const currency = await createTestCurrency();
  const account = await createTestAccount(customer.id);

  const fxRequest =
    await prisma.foreignCurrencyRequest.create({
      data: {
        userId: customer.id,
        accountId: account.id,
        requestedCurrency: currency.code,
        requestedAmount: new Prisma.Decimal("1000"),
        purposeCategory: "EDUCATION",
        purposeDescription:
          "Test foreign currency request for approval workflow",
        supportingReference: "TEST-REF",
        status: "PENDING",
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

const createRefreshToken = (user: { id: string }) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `approval-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdRequestIds.length > 0) {
    await prisma.approvalRecord.deleteMany({
      where: {
        requestId: {
          in: createdRequestIds,
        },
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        entityType: "FOREIGN_CURRENCY_REQUEST",
        entityId: {
          in: createdRequestIds,
        },
      },
    });

    await prisma.foreignCurrencyRequest.deleteMany({
      where: {
        id: {
          in: createdRequestIds,
        },
      },
    });

    createdRequestIds.length = 0;
  }

  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: {
          in: createdAccountIds,
        },
      },
    });

    createdAccountIds.length = 0;
  }

  if (createdCurrencyCodes.length > 0) {
    await prisma.currency.deleteMany({
      where: {
        code: {
          in: createdCurrencyCodes,
        },
      },
    });

    createdCurrencyCodes.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
});

describe("ADMIN Approval Decision Authorization", () => {
  it("should allow ADMIN to approve a pending FX request", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Documents verified successfully.",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.request.id).toBe(
      fxRequest.id,
    );
    expect(response.body.data.request.status).toBe(
      "APPROVED",
    );
    expect(response.body.data.request.reviewedBy).toBe(
      admin.id,
    );
    expect(response.body.data.request.reviewNotes).toBe(
      "Documents verified successfully.",
    );
  });

  it("should allow ADMIN to reject a pending FX request", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "REJECTED",
        comment: "Required documentation is incomplete.",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.request.status).toBe(
      "REJECTED",
    );
  });

  it("should allow ADMIN to request more information", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "NEEDS_MORE_INFORMATION",
        comment: "Please provide the payment document.",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.request.status).toBe(
      "NEEDS_MORE_INFORMATION",
    );
  });

  it("should reject CUSTOMER from making an approval decision", async () => {
    const customer = await createTestUser("CUSTOMER");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(customer);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Unauthorized approval.",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from making an approval decision", async () => {
    const support = await createTestUser("SUPPORT");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(support);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Unauthorized approval.",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from making an approval decision", async () => {
    const auditor = await createTestUser("AUDITOR");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Unauthorized approval.",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated approval decisions", async () => {
    const { fxRequest } = await createTestFxRequest();

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .send({
        decision: "APPROVED",
        comment: "Unauthenticated approval.",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token for approval decisions", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${refreshToken}`)
      .send({
        decision: "APPROVED",
        comment: "Refresh token test.",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the FX request does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        "/api/v1/admin/approvals/fx-requests/00000000-0000-0000-0000-000000000000/decision",
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Missing request test.",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject an invalid approval decision", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "INVALID_DECISION",
        comment: "Invalid decision test.",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject a missing comment", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should not allow a second decision after the request is approved", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const firstResponse = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "First approval.",
      });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "REJECTED",
        comment: "Second conflicting decision.",
      });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.success).toBe(false);
    expect(secondResponse.body.error.code).toBe("CONFLICT");
  });

  it("should create an ApprovalRecord after approval", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Approval record test.",
      });

    expect(response.status).toBe(200);

    const approvalRecord =
      await prisma.approvalRecord.findFirst({
        where: {
          requestId: fxRequest.id,
          reviewerId: admin.id,
          decision: "APPROVED",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(approvalRecord).not.toBeNull();
    expect(approvalRecord?.comment).toBe(
      "Approval record test.",
    );
  });

  it("should create an audit log after an approval decision", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Audit log test.",
      });

    expect(response.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "FX_REQUEST_APPROVAL_DECISION",
        entityType: "FOREIGN_CURRENCY_REQUEST",
        entityId: fxRequest.id,
        userId: admin.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toEqual({
      decision: "APPROVED",
      requestStatusBefore: "PENDING",
      requestStatusAfter: "APPROVED",
      requestedCurrency:
        response.body.data.request.requestedCurrency,
      requestedAmount: "1000",
      comment: "Audit log test.",
    });
  });

  it("should not create financial records as part of approval", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const transactionCountBefore =
      await prisma.transaction.count();

    const ledgerCountBefore =
      await prisma.ledgerEntry.count();

    const reserveMovementCountBefore =
      await prisma.reserveMovement.count();

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Execution separation test.",
      });

    expect(response.status).toBe(200);

    const transactionCountAfter =
      await prisma.transaction.count();

    const ledgerCountAfter =
      await prisma.ledgerEntry.count();

    const reserveMovementCountAfter =
      await prisma.reserveMovement.count();

    expect(transactionCountAfter).toBe(
      transactionCountBefore,
    );

    expect(ledgerCountAfter).toBe(
      ledgerCountBefore,
    );

    expect(reserveMovementCountAfter).toBe(
      reserveMovementCountBefore,
    );
  });

  it("should include requestId after a successful approval decision", async () => {
    const admin = await createTestUser("ADMIN");
    const { fxRequest } = await createTestFxRequest();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/approvals/fx-requests/${fxRequest.id}/decision`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        decision: "APPROVED",
        comment: "Request ID test.",
      });

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });
});