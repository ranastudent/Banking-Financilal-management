import request from "supertest";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

type TransferFailureStage =
  | "AFTER_SENDER_DEBIT"
  | "AFTER_RECEIVER_CREDIT"
  | "AFTER_TRANSACTION_CREATION"
  | "AFTER_FIRST_LEDGER_ENTRY"
  | "AFTER_SECOND_LEDGER_ENTRY"
  | "AFTER_AUDIT_CREATION";

describe("Fund Transfer - Rollback & Failure Safety", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  afterEach(async () => {
    /*
     * Find any transactions that may have survived.
     *
     * Normally rollback should leave none.
     * This cleanup protects the test database if a test
     * unexpectedly fails before rollback.
     */
    let transactionIds: string[] = [];

    if (createdAccountIds.length > 0) {
      const transactions =
        await prisma.transaction.findMany({
          where: {
            OR: [
              {
                sourceAccountId: {
                  in: createdAccountIds,
                },
              },
              {
                destinationAccountId: {
                  in: createdAccountIds,
                },
              },
            ],
          },
          select: {
            id: true,
          },
        });

      transactionIds = transactions.map(
        (transaction) => transaction.id,
      );
    }

    /*
     * Delete audit logs.
     */
    if (
      transactionIds.length > 0 ||
      createdUserIds.length > 0
    ) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(transactionIds.length > 0
              ? [
                  {
                    entityId: {
                      in: transactionIds,
                    },
                  },
                ]
              : []),

            ...(createdUserIds.length > 0
              ? [
                  {
                    userId: {
                      in: createdUserIds,
                    },
                  },
                ]
              : []),
          ],
        },
      });
    }

    /*
     * Delete ledger entries.
     */
    if (transactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: transactionIds,
          },
        },
      });

      /*
       * Delete transaction legs.
       */
      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: transactionIds,
          },
        },
      });

      /*
       * Delete transactions.
       */
      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: transactionIds,
          },
        },
      });
    }

    /*
     * Delete account balances.
     */
    if (createdAccountIds.length > 0) {
      await prisma.accountBalance.deleteMany({
        where: {
          accountId: {
            in: createdAccountIds,
          },
        },
      });

      /*
       * Delete accounts.
       */
      await prisma.account.deleteMany({
        where: {
          id: {
            in: createdAccountIds,
          },
        },
      });
    }

    /*
     * Delete user-related records.
     */
    if (createdUserIds.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

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

      await prisma.user.deleteMany({
        where: {
          id: {
            in: createdUserIds,
          },
        },
      });
    }

    createdUserIds.length = 0;
    createdAccountIds.length = 0;

    /*
     * Make absolutely sure failure injection is disabled
     * after every test.
     */
    delete process.env
      .TRANSFER_TEST_FAILURE_STAGE;
  });

  const createUser = async (
    email: string,
  ) => {
    const user = await prisma.user.create({
      data: {
        name: `Rollback Test User ${Date.now()}-${Math.random()}`,
        email,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccount = async (
    userId: string,
    accountNumber: string,
  ) => {
    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const createBdtBalance = async (
    accountId: string,
    availableBalance: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance,
        lockedBalance: "0",
      },
    });
  };

  const createAccessToken = (user: {
    id: string;
    email: string;
    role:
      | "CUSTOMER"
      | "ADMIN"
      | "SUPPORT"
      | "AUDITOR";
  }) => {
    return generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: "ACTIVE",
    });
  };

  const createIdempotencyKey = (
    stage: string,
  ) => {
    return `rollback-${stage}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  const executeFailedTransfer = async (
    stage: TransferFailureStage,
  ) => {
    const sender = await createUser(
      `rollback-sender-${stage}-${Date.now()}-${Math.random()}@example.com`,
    );

    const receiver = await createUser(
      `rollback-receiver-${stage}-${Date.now()}-${Math.random()}@example.com`,
    );

    const senderAccount =
      await createAccount(
        sender.id,
        `ACC-RB-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

    const receiverAccount =
      await createAccount(
        receiver.id,
        `ACC-RB-R-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(stage);

    /*
     * Capture original balances.
     */
    const beforeSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const beforeReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(beforeSender).not.toBeNull();
    expect(beforeReceiver).not.toBeNull();

    expect(
      beforeSender!.availableBalance.toString(),
    ).toBe("10000");

    expect(
      beforeReceiver!.availableBalance.toString(),
    ).toBe("5000");

    /*
     * Enable the requested failure stage.
     */
    process.env.NODE_ENV = "test";

    process.env.TRANSFER_TEST_FAILURE_STAGE =
      stage;

    let response;

    try {
      response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          idempotencyKey,
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "3000",
          currency: "BDT",
        });
    } finally {
      delete process.env
        .TRANSFER_TEST_FAILURE_STAGE;
    }

    /*
     * The intentionally injected failure must
     * prevent a successful transfer.
     */
    expect(response.status).not.toBe(200);
    expect(response.body.success).toBe(false);

    /*
     * -------------------------------------------------------
     * CHECK #1
     * Sender balance must be completely restored.
     * -------------------------------------------------------
     */
    const afterSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterSender).not.toBeNull();

    expect(
      afterSender!.availableBalance.toString(),
    ).toBe("10000");

    /*
     * -------------------------------------------------------
     * CHECK #2
     * Receiver balance must be completely restored.
     * -------------------------------------------------------
     */
    const afterReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterReceiver).not.toBeNull();

    expect(
      afterReceiver!.availableBalance.toString(),
    ).toBe("5000");

    /*
     * -------------------------------------------------------
     * CHECK #3
     * No transaction may survive.
     * -------------------------------------------------------
     */
    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId:
            senderAccount.id,
          destinationAccountId:
            receiverAccount.id,
          type: "INTERNAL_TRANSFER",
        },
      });

    expect(transactions).toHaveLength(0);

    /*
     * -------------------------------------------------------
     * CHECK #4
     * No ledger entries may survive.
     * -------------------------------------------------------
     */
    const ledgerEntries =
      await prisma.ledgerEntry.count({
        where: {
          transaction: {
            sourceAccountId:
              senderAccount.id,
            destinationAccountId:
              receiverAccount.id,
            type: "INTERNAL_TRANSFER",
          },
        },
      });

    expect(ledgerEntries).toBe(0);

    /*
     * -------------------------------------------------------
     * CHECK #5
     * No transaction legs may survive.
     * -------------------------------------------------------
     */
    const transactionLegs =
      await prisma.transactionLeg.count({
        where: {
          transaction: {
            sourceAccountId:
              senderAccount.id,
            destinationAccountId:
              receiverAccount.id,
            type: "INTERNAL_TRANSFER",
          },
        },
      });

    expect(transactionLegs).toBe(0);

    /*
     * -------------------------------------------------------
     * CHECK #6
     * No audit log may survive.
     * -------------------------------------------------------
     */
    const auditLogs =
      await prisma.auditLog.count({
        where: {
          userId: sender.id,
          action: "TRANSFER_CREATED",
        },
      });

    expect(auditLogs).toBe(0);

    /*
     * -------------------------------------------------------
     * CHECK #7
     * Total money must remain unchanged.
     * -------------------------------------------------------
     */
    const totalBalance =
      Number(
        afterSender!.availableBalance.toString(),
      ) +
      Number(
        afterReceiver!.availableBalance.toString(),
      );

    expect(totalBalance).toBe(15000);
  };

  it("14.13.1 - should rollback after sender debit", async () => {
    await executeFailedTransfer(
      "AFTER_SENDER_DEBIT",
    );
  });

  it("14.13.2 - should rollback after receiver credit", async () => {
    await executeFailedTransfer(
      "AFTER_RECEIVER_CREDIT",
    );
  });

  it("14.13.3 - should rollback after transaction creation", async () => {
    await executeFailedTransfer(
      "AFTER_TRANSACTION_CREATION",
    );
  });

  it("14.13.4 - should rollback after first ledger entry", async () => {
    await executeFailedTransfer(
      "AFTER_FIRST_LEDGER_ENTRY",
    );
  });

  it("14.13.5 - should rollback after second ledger entry", async () => {
    await executeFailedTransfer(
      "AFTER_SECOND_LEDGER_ENTRY",
    );
  });

  it("14.13.6 - should rollback after audit creation", async () => {
    await executeFailedTransfer(
      "AFTER_AUDIT_CREATION",
    );
  });
});