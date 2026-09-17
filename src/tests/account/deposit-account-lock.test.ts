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

describe("12.4 Deposit Account Row Lock", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
  });

  afterEach(async () => {
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
    }

    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.emailVerificationOtp.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.auditLog.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: createdUserIds,
          },
        },
      });
    }

    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Lock Test ${Date.now()}`,
        email: `lock-test-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
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
        accountNumber: `ACC-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  it("should block a concurrent transaction on the same account row", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);

    const firstClient = new Client({
      connectionString: env.databaseUrl,
    });

    const secondClient = new Client({
      connectionString: env.databaseUrl,
    });

    await firstClient.connect();
    await secondClient.connect();

    try {
      await firstClient.query("BEGIN");

      await firstClient.query(
        `
          SELECT id
          FROM accounts
          WHERE id = $1
          FOR UPDATE
        `,
        [account.id],
      );

      let secondLockAcquired = false;

      await secondClient.query("BEGIN");

      const secondLockPromise = secondClient
        .query(
          `
            SELECT id
            FROM accounts
            WHERE id = $1
            FOR UPDATE
          `,
          [account.id],
        )
        .then(() => {
          secondLockAcquired = true;
        });

      await new Promise((resolve) =>
        setTimeout(resolve, 300),
      );

      expect(secondLockAcquired).toBe(false);

      await firstClient.query("COMMIT");

      await secondLockPromise;

      expect(secondLockAcquired).toBe(true);

      await secondClient.query("COMMIT");
    } finally {
      try {
        await firstClient.query("ROLLBACK");
      } catch {
        // Transaction may already be committed.
      }

      try {
        await secondClient.query("ROLLBACK");
      } catch {
        // Transaction may already be committed.
      }

      await firstClient.end();
      await secondClient.end();
    }
  });
});