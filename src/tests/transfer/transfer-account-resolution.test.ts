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

describe("14.4 Transfer Sender/Receiver Resolution", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  afterEach(async () => {
    /*
     * Find transactions connected to our test accounts.
     */
    let createdTransactionIds: string[] = [];

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

      createdTransactionIds =
        transactions.map(
          (transaction) => transaction.id,
        );
    }

    /*
     * Delete audit logs associated with
     * test transactions/users.
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
     * Delete ledger entries.
     */
    if (createdTransactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Delete transaction legs.
       */
      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Delete transactions.
       */
      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

    /*
     * Delete idempotency records.
     */
    if (createdUserIds.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
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

      createdAccountIds.length = 0;
    }

    /*
     * Delete user-related records.
     */
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

      createdUserIds.length = 0;
    }
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name:
          `Transfer Resolution ${Date.now()}-${Math.random()}`,

        email:
          `transfer-resolution-${Date.now()}-${Math.random()}@example.com`,

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
    prefix: string,
  ) => {
    const account =
      await prisma.account.create({
        data: {
          userId,

          accountNumber:
            `${prefix}-${Date.now()}-${Math.floor(
              Math.random() * 100000,
            )}`,

          accountType: "SAVINGS",

          status: "ACTIVE",
        },
      });

    createdAccountIds.push(account.id);

    return account;
  };

  const createBalance = async (
    accountId: string,
    amount: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,

        currencyCode: "BDT",

        availableBalance: amount,

        lockedBalance: "0",
      },
    });
  };

  const createAccessToken = (user: {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";
}) => {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: "ACTIVE",
  });
  };

  const createIdempotencyKey = () => {
    return `transfer-resolution-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  it(
    "should resolve sender and receiver account numbers to the correct internal account IDs",
    async () => {
      /*
       * Create separate owners so that the test proves
       * both account numbers are resolved independently.
       */
      const senderOwner =
        await createUser();

      const receiverOwner =
        await createUser();

      const senderAccount =
        await createAccount(
          senderOwner.id,
          "RESOLUTION-SENDER",
        );

      const receiverAccount =
        await createAccount(
          receiverOwner.id,
          "RESOLUTION-RECEIVER",
        );

      await createBalance(
        senderAccount.id,
        "10000.00",
      );

      await createBalance(
        receiverAccount.id,
        "5000.00",
      );

      /*
       * Authenticate as the sender owner.
       */
      const accessToken =
        createAccessToken(senderOwner);

      /*
       * IMPORTANT:
       *
       * The API receives account NUMBERS,
       * not internal UUIDs.
       */
      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,

          receiverAccount:
            receiverAccount.accountNumber,

          amount: "1000.00",

          currency: "BDT",
        });

      /*
       * The transfer itself must succeed.
       */
      expect(response.status).toBe(200);

      expect(
        response.body.success,
      ).toBe(true);

      /*
       * Read the created transaction from
       * the database.
       */
      const transaction =
        await prisma.transaction.findFirst({
          where: {
            sourceAccountId:
              senderAccount.id,

            destinationAccountId:
              receiverAccount.id,
          },

          orderBy: {
            createdAt: "desc",
          },

          select: {
            id: true,

            sourceAccountId: true,

            destinationAccountId: true,

            reference: true,

            type: true,

            status: true,

            amount: true,

            currencyCode: true,
          },
        });

      expect(transaction).not.toBeNull();

      /*
       * 14.4 Sender Resolution
       *
       * Request:
       * senderAccount = senderAccount.accountNumber
       *
       * Expected:
       * transaction.sourceAccountId =
       * senderAccount.id
       */
      expect(
        transaction!.sourceAccountId,
      ).toBe(senderAccount.id);

      /*
       * 14.4 Receiver Resolution
       *
       * Request:
       * receiverAccount = receiverAccount.accountNumber
       *
       * Expected:
       * transaction.destinationAccountId =
       * receiverAccount.id
       */
      expect(
        transaction!.destinationAccountId,
      ).toBe(receiverAccount.id);

      /*
       * Additional transaction assertions.
       */
      expect(
        transaction!.type,
      ).toBe("INTERNAL_TRANSFER");

      expect(
        transaction!.status,
      ).toBe("COMPLETED");

      expect(
        transaction!.amount.toString(),
      ).toBe("1000");

      expect(
        transaction!.currencyCode,
      ).toBe("BDT");

      /*
       * Verify the API response also exposes
       * the correct external account numbers.
       */
      
    },
  );
});