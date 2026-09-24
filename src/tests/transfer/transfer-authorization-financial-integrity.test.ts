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

describe(
  "14.3.5 Transfer Authorization / Financial Integrity",
  () => {
    const createdUserIds: string[] = [];
    const createdAccountIds: string[] = [];
    const createdTransactionIds: string[] = [];

    afterEach(async () => {
      /*
       * Delete transaction-related records first.
       */
      if (createdTransactionIds.length > 0) {
        await prisma.transactionLeg.deleteMany({
          where: {
            transactionId: {
              in: createdTransactionIds,
            },
          },
        });

        await prisma.ledgerEntry.deleteMany({
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

        createdTransactionIds.length = 0;
      }

      /*
       * Remove idempotency records belonging
       * to the test users.
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
       * Remove account balances before accounts.
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

        createdAccountIds.length = 0;
      }

      /*
       * Remove user-related records.
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

    const createUser = async (
      role:
        | "CUSTOMER"
        | "ADMIN"
        | "SUPPORT"
        | "AUDITOR",
    ) => {
      const user = await prisma.user.create({
        data: {
          name:
            `Transfer Integrity ${Date.now()}-${Math.random()}`,

          email:
            `transfer-integrity-${Date.now()}-${Math.random()}@example.com`,

          passwordHash: "test-password-hash",

          role,

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
      currencyCode: string,
      amount: string,
    ) => {
      return prisma.accountBalance.create({
        data: {
          accountId,

          currencyCode,

          availableBalance: amount,

          lockedBalance: "0",
        },
      });
    };

    const createAccessToken = (
      user: {
        id: string;
        email: string;
        role:
          | "CUSTOMER"
          | "ADMIN"
          | "SUPPORT"
          | "AUDITOR";
      },
    ) => {
      return generateAccessToken({
        id: user.id,

        email: user.email,

        role: user.role,

        status: "ACTIVE",
      });
    };

    const createIdempotencyKey = (
      prefix: string,
    ) => {
      return `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    };

    it(
      "should reject unauthorized customer transfer without changing financial state",
      async () => {
        /*
         * User A owns the sender account.
         */
        const senderOwner =
          await createUser("CUSTOMER");

        /*
         * User B owns the receiver account.
         */
        const receiverOwner =
          await createUser("CUSTOMER");

        /*
         * User C does not own the sender account.
         */
        const unauthorizedCustomer =
          await createUser("CUSTOMER");

        const senderAccount =
          await createAccount(
            senderOwner.id,
            "SENDER",
          );

        const receiverAccount =
          await createAccount(
            receiverOwner.id,
            "RECEIVER",
          );

        await createBalance(
          senderAccount.id,
          "BDT",
          "10000.00",
        );

        await createBalance(
          receiverAccount.id,
          "BDT",
          "5000.00",
        );

        /*
         * Capture sender balance BEFORE request.
         */
        const senderBalanceBefore =
          await prisma.accountBalance.findFirst({
            where: {
              accountId: senderAccount.id,

              currencyCode: "BDT",
            },
          });

        /*
         * Capture receiver balance BEFORE request.
         */
        const receiverBalanceBefore =
          await prisma.accountBalance.findFirst({
            where: {
              accountId: receiverAccount.id,

              currencyCode: "BDT",
            },
          });

        expect(
          senderBalanceBefore,
        ).not.toBeNull();

        expect(
          receiverBalanceBefore,
        ).not.toBeNull();

        /*
         * Capture transaction count BEFORE request.
         */
        const transactionCountBefore =
          await prisma.transaction.count({
            where: {
              OR: [
                {
                  sourceAccountId:
                    senderAccount.id,
                },
                {
                  destinationAccountId:
                    receiverAccount.id,
                },
              ],
            },
          });

        /*
         * Capture ledger count BEFORE request.
         */
        const ledgerCountBefore =
          await prisma.ledgerEntry.count({
            where: {
              accountId: {
                in: [
                  senderAccount.id,
                  receiverAccount.id,
                ],
              },
            },
          });

        const accessToken =
          createAccessToken(
            unauthorizedCustomer,
          );

        /*
         * Unauthorized CUSTOMER attempts
         * to transfer from another customer's account.
         */
        const response = await request(app)
          .post("/api/v1/transfers")
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            createIdempotencyKey(
              "unauthorized-transfer",
            ),
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
         * Authorization must reject the request.
         */
        expect(response.status).toBe(403);

        expect(
          response.body.success,
        ).toBe(false);

        expect(
          response.body.error.code,
        ).toBe("FORBIDDEN");

        /*
         * Verify sender available balance
         * was NOT debited.
         */
        const senderBalanceAfter =
          await prisma.accountBalance.findFirst({
            where: {
              accountId: senderAccount.id,

              currencyCode: "BDT",
            },
          });

        expect(
          senderBalanceAfter,
        ).not.toBeNull();

        expect(
          senderBalanceAfter!.availableBalance.toString(),
        ).toBe(
          senderBalanceBefore!.availableBalance.toString(),
        );

        /*
         * Verify sender locked balance
         * was also not changed.
         */
        expect(
          senderBalanceAfter!.lockedBalance.toString(),
        ).toBe(
          senderBalanceBefore!.lockedBalance.toString(),
        );

        /*
         * Verify receiver available balance
         * was NOT credited.
         */
        const receiverBalanceAfter =
          await prisma.accountBalance.findFirst({
            where: {
              accountId: receiverAccount.id,

              currencyCode: "BDT",
            },
          });

        expect(
          receiverBalanceAfter,
        ).not.toBeNull();

        expect(
          receiverBalanceAfter!.availableBalance.toString(),
        ).toBe(
          receiverBalanceBefore!.availableBalance.toString(),
        );

        /*
         * Verify receiver locked balance
         * was also not changed.
         */
        expect(
          receiverBalanceAfter!.lockedBalance.toString(),
        ).toBe(
          receiverBalanceBefore!.lockedBalance.toString(),
        );

        /*
         * Verify no transfer transaction
         * was created.
         */
        const transactionCountAfter =
          await prisma.transaction.count({
            where: {
              OR: [
                {
                  sourceAccountId:
                    senderAccount.id,
                },
                {
                  destinationAccountId:
                    receiverAccount.id,
                },
              ],
            },
          });

        expect(
          transactionCountAfter,
        ).toBe(transactionCountBefore);

        /*
         * Verify no ledger movement
         * was created.
         */
        const ledgerCountAfter =
          await prisma.ledgerEntry.count({
            where: {
              accountId: {
                in: [
                  senderAccount.id,
                  receiverAccount.id,
                ],
              },
            },
          });

        expect(
          ledgerCountAfter,
        ).toBe(ledgerCountBefore);
      },
    );
  },
);