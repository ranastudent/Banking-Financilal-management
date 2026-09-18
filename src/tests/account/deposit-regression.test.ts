import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import  app  from "../../app";
import { Prisma } from "@prisma/client";

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

describe("12.11.6 Full Deposit Regression", () => {
  it("should complete the complete deposit lifecycle", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(
        user.id,
        "10000.00",
      );

    const accessToken =
      createDepositAccessToken(user);

    const key = depositKey("full-lifecycle");

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "1500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.requestId).toBeDefined();

    expect(response.body.data.accountId).toBe(
      account.id,
    );

    expect(response.body.data.amount).toBe(
      "1500",
    );

    expect(response.body.data.currency).toBe(
      "BDT",
    );

    expect(
      response.body.data.transaction.type,
    ).toBe("DEPOSIT");

    expect(
      response.body.data.transaction.status,
    ).toBe("PENDING");

    expect(
      response.body.data.ledgerEntry.entryType,
    ).toBe("CREDIT");

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("11500.00"),
      ),
    ).toBe(true);

    expect(
      balance.lockedBalance.eq(
        new Prisma.Decimal("0"),
      ),
    ).toBe(true);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(1);

    expect(
      transactions[0]?.amount.eq(
        new Prisma.Decimal("1500.00"),
      ),
    ).toBe(true);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(1);

    expect(
      ledgerEntries[0]?.entryType,
    ).toBe("CREDIT");

    expect(
      ledgerEntries[0]?.balanceBefore.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    expect(
      ledgerEntries[0]?.balanceAfter.eq(
        new Prisma.Decimal("11500.00"),
      ),
    ).toBe(true);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(1);

    const idempotencyRecord =
      await getDepositIdempotencyRecord(
        user.id,
        key,
      );

    expect(idempotencyRecord).not.toBeNull();

    if (!idempotencyRecord) {
      throw new Error(
        "Expected idempotency record was not found",
      );
    }

    expect(idempotencyRecord.responseStatus).toBe(
      200,
    );
  });

  it("should never allow a customer to deposit into another customer's account", async () => {
    const owner = await createDepositTestUser();

    const customer =
      await createDepositTestUser();

    const account =
      await createDepositTestAccount(owner.id);

    const accessToken =
      createDepositAccessToken(customer);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "9999.99",
        currency: "BDT",
      });

    expect(response.status).toBe(403);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);
  });

  it("should make a repeated request idempotent", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const key = depositKey("regression-replay");

    const first = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "2000.00",
        currency: "BDT",
      });

    expect(first.status).toBe(200);

    const second = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "2000.00",
        currency: "BDT",
      });

    expect(second.status).toBe(200);

    expect(second.body.data).toEqual(
      first.body.data,
    );

    const balance =
      await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("12000.00"),
      ),
    ).toBe(true);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(1);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(1);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(1);
  });

  it("should preserve the balance when a deposit fails because the account is frozen", async () => {
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

    const key = depositKey(
      "regression-failure",
    );

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

    const balance =
      await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

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

  it("should preserve atomic balance updates under concurrent deposits", async () => {
    const user = await createDepositTestUser();

    const account =
      await createDepositTestAccount(
        user.id,
        "10000.00",
      );

    const accessToken =
      createDepositAccessToken(user);

    const requests = [
      request(app)
        .post(
          `/api/v1/accounts/${account.id}/deposits`,
        )
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          depositKey("regression-concurrent-a"),
        )
        .send({
          amount: "100.00",
          currency: "BDT",
        }),

      request(app)
        .post(
          `/api/v1/accounts/${account.id}/deposits`,
        )
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          depositKey("regression-concurrent-b"),
        )
        .send({
          amount: "200.00",
          currency: "BDT",
        }),

      request(app)
        .post(
          `/api/v1/accounts/${account.id}/deposits`,
        )
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          depositKey("regression-concurrent-c"),
        )
        .send({
          amount: "300.00",
          currency: "BDT",
        }),
    ];

    const responses =
      await Promise.all(requests);

    expect(
      responses.map(
        (response) => response.status,
      ),
    ).toEqual([200, 200, 200]);

    const balance =
      await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10600.00"),
      ),
    ).toBe(true);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(3);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(3);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(3);
  });
});