import "../setup";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

type TestRole = "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdOutboxEventIds: string[] = [];

const unique = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createUser = async (role: TestRole = "CUSTOMER") => {
  const user = await prisma.user.create({
    data: {
      name: unique("Phase 32 Risk User"),
      email: `${unique("phase32-risk")}@example.com`,
      passwordHash: "integration-test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  createdUserIds.push(user.id);
  return user;
};

const createAccount = async (userId: string, prefix: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: unique(prefix).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30),
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });
  createdAccountIds.push(account.id);
  return account;
};

const createBalance = async (accountId: string, amount: string) =>
  prisma.accountBalance.create({
    data: {
      accountId,
      currencyCode: "BDT",
      availableBalance: amount,
      lockedBalance: "0",
    },
  });

const tokenFor = (user: { id: string; email: string; role: TestRole }) =>
  generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: "ACTIVE",
  });

const createHighRiskTransfer = async () => {
  const customer = await createUser("CUSTOMER");
  const receiver = await createUser("CUSTOMER");
  const admin = await createUser("ADMIN");
  const senderAccount = await createAccount(customer.id, "P32-SENDER");
  const receiverAccount = await createAccount(receiver.id, "P32-RECEIVER");

  // Large-transfer (40) + new-beneficiary (20) reaches the configured HOLD
  // threshold without relying on time-of-day or historical-activity rules.
  const amount = Number(process.env.RISK_LARGE_TRANSFER_THRESHOLD ?? 25000);
  const maxTransfer = Number(process.env.TRANSFER_MAX_AMOUNT ?? 50000);
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxTransfer) {
    throw new Error(
      "Phase 32 integration test requires RISK_LARGE_TRANSFER_THRESHOLD to be positive and no greater than TRANSFER_MAX_AMOUNT.",
    );
  }

  await createBalance(senderAccount.id, String(amount * 2));
  await createBalance(receiverAccount.id, "1000");

  const response = await request(app)
    .post("/api/v1/transfers")
    .set("Authorization", `Bearer ${tokenFor(customer)}`)
    .set("Idempotency-Key", unique("phase32-risk-transfer"))
    .send({
      senderAccount: senderAccount.accountNumber,
      receiverAccount: receiverAccount.accountNumber,
      amount: String(amount),
      currency: "BDT",
    });

  expect(response.status).toBe(202);
  expect(response.body.success).toBe(true);
  expect(response.body.data?.transaction?.status).toBe("ON_HOLD");

  const heldTransaction = await prisma.transaction.findFirst({
    where: {
      sourceAccountId: senderAccount.id,
      destinationAccountId: receiverAccount.id,
      type: "INTERNAL_TRANSFER",
      status: "ON_HOLD",
    },
    orderBy: { createdAt: "desc" },
  });
  expect(heldTransaction).not.toBeNull();
  if (!heldTransaction) throw new Error("Expected a held transfer to be persisted");
  createdTransactionIds.push(heldTransaction.id);

  const risk = await prisma.riskAnalysis.findUnique({
    where: { transactionId: heldTransaction.id },
  });
  expect(risk).not.toBeNull();
  if (!risk) throw new Error("Expected risk assessment for held transfer");

  return {
    customer,
    receiver,
    admin,
    senderAccount,
    receiverAccount,
    amount,
    heldTransaction,
    risk,
  };
};

afterEach(async () => {
  // Capture the notification outbox events generated for this test's users.
  if (createdUserIds.length > 0) {
    const events = await prisma.outboxEvent.findMany({
      where: { eventType: "NOTIFICATION_REQUESTED" },
      select: { id: true, payload: true },
    });
    for (const event of events) {
      const payload = event.payload as { userId?: unknown; actorUserId?: unknown } | null;
      if (
        (typeof payload?.userId === "string" && createdUserIds.includes(payload.userId)) ||
        (typeof payload?.actorUserId === "string" && createdUserIds.includes(payload.actorUserId))
      ) {
        createdOutboxEventIds.push(event.id);
      }
    }
  }

  if (createdOutboxEventIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdOutboxEventIds } } });
  }

  if (createdAccountIds.length > 0) {
    const related = await prisma.transaction.findMany({
      where: {
        OR: [
          { sourceAccountId: { in: createdAccountIds } },
          { destinationAccountId: { in: createdAccountIds } },
        ],
      },
      select: { id: true },
    });
    for (const row of related) {
      if (!createdTransactionIds.includes(row.id)) createdTransactionIds.push(row.id);
    }
  }

  if (createdTransactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: createdTransactionIds } } });
    await prisma.transactionLeg.deleteMany({ where: { transactionId: { in: createdTransactionIds } } });
    await prisma.riskReview.deleteMany({
      where: { riskAnalysis: { is: { transactionId: { in: createdTransactionIds } } } },
    });
    await prisma.riskAnalysis.deleteMany({ where: { transactionId: { in: createdTransactionIds } } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: createdTransactionIds } },
          ...(createdUserIds.length ? [{ userId: { in: createdUserIds } }] : []),
        ],
      },
    });
    await prisma.transaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
  } else if (createdUserIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  }

  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({ where: { accountId: { in: createdAccountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: createdAccountIds } } });
  }

  if (createdUserIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.emailVerificationOtp.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  createdOutboxEventIds.length = 0;
  createdTransactionIds.length = 0;
  createdAccountIds.length = 0;
  createdUserIds.length = 0;
});

describe("Phase 32 — preventive risk transfer and admin review integration", () => {
  it("holds a HIGH-risk transfer before money movement and persists the review evidence", async () => {
    const fixture = await createHighRiskTransfer();

    expect(fixture.risk.riskLevel).toBe("HIGH");
    expect(fixture.risk.decision).toBe("HOLD");
    expect(fixture.risk.reviewStatus).toBe("PENDING");
    expect(fixture.heldTransaction.status).toBe("ON_HOLD");

    const [senderBalance, receiverBalance, ledgerCount, legCount, audit] = await Promise.all([
      prisma.accountBalance.findFirst({ where: { accountId: fixture.senderAccount.id, currencyCode: "BDT" } }),
      prisma.accountBalance.findFirst({ where: { accountId: fixture.receiverAccount.id, currencyCode: "BDT" } }),
      prisma.ledgerEntry.count({ where: { transactionId: fixture.heldTransaction.id } }),
      prisma.transactionLeg.count({ where: { transactionId: fixture.heldTransaction.id } }),
      prisma.auditLog.findFirst({ where: { entityId: fixture.heldTransaction.id, action: "TRANSFER_HELD_FOR_RISK_REVIEW" } }),
    ]);

    expect(senderBalance?.availableBalance.toString()).toBe(String(fixture.amount * 2));
    expect(receiverBalance?.availableBalance.toString()).toBe("1000");
    expect(ledgerCount).toBe(0);
    expect(legCount).toBe(0);
    expect(audit).not.toBeNull();
  });

  it("allows an ADMIN to reject a held transfer without moving money", async () => {
    const fixture = await createHighRiskTransfer();

    const response = await request(app)
      .post(`/api/v1/admin/risk-reviews/${fixture.risk.id}/decision`)
      .set("Authorization", `Bearer ${tokenFor(fixture.admin)}`)
      .send({ decision: "REJECTED", comment: "Integration test rejection" });

    expect(response.status).toBe(200);

    const [held, risk, senderBalance, receiverBalance, review, ledgerCount] = await Promise.all([
      prisma.transaction.findUnique({ where: { id: fixture.heldTransaction.id } }),
      prisma.riskAnalysis.findUnique({ where: { id: fixture.risk.id } }),
      prisma.accountBalance.findFirst({ where: { accountId: fixture.senderAccount.id, currencyCode: "BDT" } }),
      prisma.accountBalance.findFirst({ where: { accountId: fixture.receiverAccount.id, currencyCode: "BDT" } }),
      prisma.riskReview.findFirst({ where: { riskAnalysisId: fixture.risk.id } }),
      prisma.ledgerEntry.count({ where: { transactionId: fixture.heldTransaction.id } }),
    ]);

    expect(held?.status).toBe("CANCELLED");
    expect(risk?.reviewStatus).toBe("REJECTED");
    expect(review?.decision).toBe("REJECTED");
    expect(senderBalance?.availableBalance.toString()).toBe(String(fixture.amount * 2));
    expect(receiverBalance?.availableBalance.toString()).toBe("1000");
    expect(ledgerCount).toBe(0);
  });

  it("allows an ADMIN to approve through the existing transfer service exactly once", async () => {
    const fixture = await createHighRiskTransfer();

    const response = await request(app)
      .post(`/api/v1/admin/risk-reviews/${fixture.risk.id}/decision`)
      .set("Authorization", `Bearer ${tokenFor(fixture.admin)}`)
      .send({ decision: "APPROVED", comment: "Integration test approval" });

    expect(response.status).toBe(200);

    const [held, risk, senderBalance, receiverBalance, review, completed] = await Promise.all([
      prisma.transaction.findUnique({ where: { id: fixture.heldTransaction.id } }),
      prisma.riskAnalysis.findUnique({ where: { id: fixture.risk.id } }),
      prisma.accountBalance.findFirst({ where: { accountId: fixture.senderAccount.id, currencyCode: "BDT" } }),
      prisma.accountBalance.findFirst({ where: { accountId: fixture.receiverAccount.id, currencyCode: "BDT" } }),
      prisma.riskReview.findFirst({ where: { riskAnalysisId: fixture.risk.id } }),
      prisma.transaction.findMany({
        where: {
          sourceAccountId: fixture.senderAccount.id,
          destinationAccountId: fixture.receiverAccount.id,
          type: "INTERNAL_TRANSFER",
          status: "COMPLETED",
        },
      }),
    ]);

    expect(held?.status).toBe("CANCELLED");
    expect(risk?.reviewStatus).toBe("APPROVED");
    expect(review?.decision).toBe("APPROVED");
    expect(senderBalance?.availableBalance.toString()).toBe(String(fixture.amount));
    expect(receiverBalance?.availableBalance.toString()).toBe(String(1000 + fixture.amount));
    expect(completed).toHaveLength(1);
    createdTransactionIds.push(...completed.map((transaction) => transaction.id));

    const duplicate = await request(app)
      .post(`/api/v1/admin/risk-reviews/${fixture.risk.id}/decision`)
      .set("Authorization", `Bearer ${tokenFor(fixture.admin)}`)
      .send({ decision: "APPROVED", comment: "Duplicate approval must fail" });

    expect(duplicate.status).toBe(409);

    const finalSenderBalance = await prisma.accountBalance.findFirst({
      where: { accountId: fixture.senderAccount.id, currencyCode: "BDT" },
    });
    expect(finalSenderBalance?.availableBalance.toString()).toBe(String(fixture.amount));
  });

  it("denies risk-review access to an authenticated non-admin user", async () => {
    const fixture = await createHighRiskTransfer();

    const response = await request(app)
      .get("/api/v1/admin/risk-reviews")
      .set("Authorization", `Bearer ${tokenFor(fixture.customer)}`);

    expect(response.status).toBe(403);
  });
});
