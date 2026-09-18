import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import  app  from "../../app";

import {
  cleanupDepositTestData,
  createDepositAccessToken,
  createDepositTestAccount,
  createDepositTestUser,
  depositKey,
  getDepositAuditLogs,
  getDepositBalance,
  getDepositIdempotencyRecord,
  getDepositLedgerEntries,
  getDepositTransactions,
} from "./deposit-test.helpers";
import { prisma } from "../../config/prisma";

afterEach(async () => {
  await cleanupDepositTestData();
});

describe("12.11.5 Deposit Failure + Data Integrity Integration", () => {
  it("should not mutate financial data when the account is inactive", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(user.id);

    await prisma.account.update({
      where: {
        id: account.id,
      },
      data: {
        status: "FROZEN",
      },
    });

    const accessToken =
      createDepositAccessToken(user);

    const key = depositKey("inactive-account");

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(409);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10000",
    );

    expect(balance.lockedBalance.toString()).toBe(
      "0",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(0);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(0);

    const idempotencyRecord =
      await getDepositIdempotencyRecord(
        user.id,
        key,
      );

    expect(idempotencyRecord).toBeNull();
  });

  it("should not mutate financial data when the currency does not exist", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "QZX",
      });

    expect(response.status).toBe(404);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10000",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(0);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(0);
  });

  it("should not mutate financial data for an invalid account ID", async () => {
    const user = await createDepositTestUser();

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post("/api/v1/accounts/invalid-account-id/deposits")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should process concurrent deposits without losing balance updates", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(
        user.id,
        "10000.00",
      );

    const accessToken =
      createDepositAccessToken(user);

    const request1 = request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set(
        "Idempotency-Key",
        depositKey("concurrent-1"),
      )
      .send({
        amount: "100.00",
        currency: "BDT",
      });

    const request2 = request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set(
        "Idempotency-Key",
        depositKey("concurrent-2"),
      )
      .send({
        amount: "200.00",
        currency: "BDT",
      });

    const [response1, response2] =
      await Promise.all([
        request1,
        request2,
      ]);

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    const balance =
      await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(balance.availableBalance.toString()).toBe(
      "10300",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(2);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(2);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(2);
  });
});