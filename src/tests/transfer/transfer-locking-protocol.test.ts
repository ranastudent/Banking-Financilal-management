import { Client } from "pg";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";

describe("Stage 2C transfer locking protocol", () => {
  let userId: string;
  let accountId: string;
  let balanceId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        name: `Stage 2C Lock Test ${Date.now()}`,
        email: `stage2c-lock-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });
    userId = user.id;

    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `S2C-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });
    accountId = account.id;

    const balance = await prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance: "10000",
        lockedBalance: "0",
      },
    });
    balanceId = balance.id;
  });

  afterEach(async () => {
    await prisma.accountBalance.deleteMany({
      where: { id: balanceId },
    });
    await prisma.account.deleteMany({
      where: { id: accountId },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
  });

  it("allows concurrent Account FOR SHARE locks", async () => {
    const first = new Client({
      connectionString: env.databaseUrl,
    });
    const second = new Client({
      connectionString: env.databaseUrl,
    });

    await first.connect();
    await second.connect();

    try {
      await first.query("BEGIN");
      await first.query(
        `SELECT id FROM accounts WHERE id = $1 FOR SHARE`,
        [accountId],
      );

      await second.query("BEGIN");

      let secondAcquired = false;
      const secondLock = second
        .query(
          `SELECT id FROM accounts WHERE id = $1 FOR SHARE`,
          [accountId],
        )
        .then(() => {
          secondAcquired = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(secondAcquired).toBe(true);

      await secondLock;
      await second.query("COMMIT");
      await first.query("COMMIT");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await first.end();
      await second.end();
    }
  });

  it("makes an Account status UPDATE wait for a financial operation", async () => {
    const first = new Client({
      connectionString: env.databaseUrl,
    });
    const second = new Client({
      connectionString: env.databaseUrl,
    });

    await first.connect();
    await second.connect();

    try {
      await first.query("BEGIN");
      await first.query(
        `SELECT id FROM accounts WHERE id = $1 FOR SHARE`,
        [accountId],
      );

      await first.query(
        `SELECT id FROM account_balances WHERE id = $1 FOR UPDATE`,
        [balanceId],
      );

      await second.query("BEGIN");

      let statusUpdated = false;
      const statusUpdate = second
        .query(
          `UPDATE accounts SET status = 'FROZEN' WHERE id = $1`,
          [accountId],
        )
        .then(() => {
          statusUpdated = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(statusUpdated).toBe(false);

      await first.query("COMMIT");
      await statusUpdate;

      expect(statusUpdated).toBe(true);

      await second.query("COMMIT");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await first.end();
      await second.end();
    }
  });

  it("serializes concurrent financial mutations on the same AccountBalance", async () => {
    const first = new Client({
      connectionString: env.databaseUrl,
    });
    const second = new Client({
      connectionString: env.databaseUrl,
    });

    await first.connect();
    await second.connect();

    try {
      await first.query("BEGIN");
      await first.query(
        `SELECT id FROM account_balances WHERE id = $1 FOR UPDATE`,
        [balanceId],
      );

      await second.query("BEGIN");

      let secondAcquired = false;
      const secondLock = second
        .query(
          `SELECT id FROM account_balances WHERE id = $1 FOR UPDATE`,
          [balanceId],
        )
        .then(() => {
          secondAcquired = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(secondAcquired).toBe(false);

      await first.query("COMMIT");
      await secondLock;

      expect(secondAcquired).toBe(true);

      await second.query("COMMIT");
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      await first.end();
      await second.end();
    }
  });
});
