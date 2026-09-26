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

describe("Fund Transfer - Audit Log", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  /*
   * --------------------------------------------------------
   * Cleanup
   * --------------------------------------------------------
   */

  afterEach(async () => {
    /*
     * Find transactions related to test accounts.
     */
    if (createdAccountIds.length > 0) {
      const relatedTransactions =
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

      for (const transaction of relatedTransactions) {
        if (
          !createdTransactionIds.includes(
            transaction.id,
          )
        ) {
          createdTransactionIds.push(
            transaction.id,
          );
        }
      }
    }

    /*
     * ------------------------------------------------------
     * Delete audit logs related to test transactions/users.
     * ------------------------------------------------------
     */

    if (
      createdTransactionIds.length > 0 ||
      createdUserIds.length > 0
    ) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(createdTransactionIds.length > 0
              ? [
                  {
                    entityId: {
                      in: createdTransactionIds,
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
     * ------------------------------------------------------
     * Delete ledger entries and transaction legs.
     * ------------------------------------------------------
     */

    if (createdTransactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

    /*
     * ------------------------------------------------------
     * Delete account balances and accounts.
     * ------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------
     * Delete users.
     * ------------------------------------------------------
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

    createdTransactionIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  /*
   * --------------------------------------------------------
   * Helpers
   * --------------------------------------------------------
   */

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Transfer Audit User ${Date.now()}-${Math.random()}`,
        email: `transfer-audit-${Date.now()}-${Math.random()}@example.com`,
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

  const createIdempotencyKey = () => {
    return `audit-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  /*
   * ========================================================
   * 14.12.1
   *
   * Create audit record for successful transfer.
   * ========================================================
   */

  it("should create an audit log for a successful transfer", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-AUDIT-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-AUDIT-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "2000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey();

    const response = await request(app)
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
        amount: "5000",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    /*
     * ------------------------------------------------------
     * Verify requestId exists at API level.
     * ------------------------------------------------------
     */

    expect(response.body.requestId).toEqual(
      expect.any(String),
    );

    /*
     * ------------------------------------------------------
     * Find created transaction.
     * ------------------------------------------------------
     */

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId:
            senderAccount.id,

          destinationAccountId:
            receiverAccount.id,

          type: "INTERNAL_TRANSFER",
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    if (!transaction) {
      throw new Error(
        "Expected transfer transaction to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    /*
     * ------------------------------------------------------
     * Find audit log.
     * ------------------------------------------------------
     */

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: sender.id,
          action: "TRANSFER_CREATED",
          entityType: "TRANSACTION",
          entityId: transaction.id,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    if (!auditLog) {
      throw new Error(
        "Expected transfer audit log to exist",
      );
    }

    /*
     * ------------------------------------------------------
     * Actor / user
     * ------------------------------------------------------
     */

    expect(auditLog.userId).toBe(
      sender.id,
    );

    /*
     * ------------------------------------------------------
     * Action
     * ------------------------------------------------------
     */

    expect(auditLog.action).toBe(
      "TRANSFER_CREATED",
    );

    /*
     * ------------------------------------------------------
     * Entity
     * ------------------------------------------------------
     */

    expect(auditLog.entityType).toBe(
      "TRANSACTION",
    );

    expect(auditLog.entityId).toBe(
      transaction.id,
    );
  });

  /*
   * ========================================================
   * 14.12.2
   *
   * Verify transfer-specific metadata.
   * ========================================================
   */

  it("should store sender, receiver, amount, currency, transaction and actor role in audit metadata", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-AUDIT-META-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-AUDIT-META-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "15000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "3000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey();

    const response = await request(app)
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
        amount: "7500",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId:
            senderAccount.id,

          destinationAccountId:
            receiverAccount.id,

          type: "INTERNAL_TRANSFER",
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    if (!transaction) {
      throw new Error(
        "Expected transfer transaction to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: sender.id,
          action: "TRANSFER_CREATED",
          entityId: transaction.id,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    if (!auditLog) {
      throw new Error(
        "Expected transfer audit log to exist",
      );
    }

    const metadata =
      auditLog.metadata as Record<
        string,
        unknown
      >;

    /*
     * Operation
     */

    expect(metadata.operation).toBe(
      "INTERNAL_FUND_TRANSFER",
    );

    /*
     * Transaction
     */

    /*
     * Current transfer audit architecture does
     * not store transactionId in metadata.
     *
     * The transaction is represented by entityId.
     */

    expect(auditLog.entityId).toBe(
      transaction.id,
    );

    /*
     * Sender
     */

    expect(metadata.senderAccount).toBe(
      senderAccount.accountNumber,
    );

    /*
     * Receiver
     */

    expect(metadata.receiverAccount).toBe(
      receiverAccount.accountNumber,
    );

    /*
     * Amount
     */

    expect(metadata.amount).toBe(
      "7500",
    );

    /*
     * Currency
     */

    expect(metadata.currencyCode).toBe(
      "BDT",
    );

    /*
     * Actor role
     */

    expect(metadata.userRole).toBe(
      "CUSTOMER",
    );
  });

  /*
   * ========================================================
   * 14.12.3
   *
   * Verify audit description.
   * ========================================================
   */

  it("should store a useful transfer audit description", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-AUDIT-DESC-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-AUDIT-DESC-R-${Date.now()}-${Math.random()
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
      createIdempotencyKey();

    const response = await request(app)
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
        amount: "2500",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId:
            senderAccount.id,

          destinationAccountId:
            receiverAccount.id,

          type: "INTERNAL_TRANSFER",
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    if (!transaction) {
      throw new Error(
        "Expected transfer transaction to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    const auditLog =
      await prisma.auditLog.findFirst({
        where: {
          userId: sender.id,
          action: "TRANSFER_CREATED",
          entityId: transaction.id,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(auditLog).not.toBeNull();

    if (!auditLog) {
      throw new Error(
        "Expected transfer audit log to exist",
      );
    }

    expect(auditLog.description).toContain(
      transaction.reference,
    );

    expect(auditLog.description).toContain(
      senderAccount.accountNumber,
    );

    expect(auditLog.description).toContain(
      receiverAccount.accountNumber,
    );
  });
});