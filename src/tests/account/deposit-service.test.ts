import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../../config/prisma";
import {
  prepareDeposit,
} from "../../transaction/services/deposit.service";

describe(
  "12.3 Deposit Service + DB Transaction",
  () => {
    const createdUserIds: string[] = [];
    const createdAccountIds: string[] = [];
    const createdTransactionIds: string[] = [];

    beforeEach(async () => {
      createdUserIds.length = 0;
      createdAccountIds.length = 0;
      createdTransactionIds.length = 0;

      /*
       * Keep BDT active for deposit tests.
       */
      await prisma.currency.update({
        where: {
          code: "BDT",
        },
        data: {
          isActive: true,
        },
      });
    });

    afterEach(async () => {
      /*
       * prepareDeposit() can create:
       *
       * Transaction
       * TransactionLeg
       * LedgerEntry
       * AuditLog
       *
       * Discover transactions by the test accounts first.
       */
      if (createdAccountIds.length > 0) {
        const transactions =
          await prisma.transaction.findMany({
            where: {
              OR: [
                {
                  destinationAccountId: {
                    in: createdAccountIds,
                  },
                },
                {
                  sourceAccountId: {
                    in: createdAccountIds,
                  },
                },
              ],
            },
            select: {
              id: true,
            },
          });

        for (const transaction of transactions) {
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
       * Remove audit logs before their related
       * transactions/users are deleted.
       */
      if (
        createdUserIds.length > 0 ||
        createdTransactionIds.length > 0
      ) {
        await prisma.auditLog.deleteMany({
          where: {
            OR: [
              ...(createdUserIds.length > 0
                ? [
                    {
                      userId: {
                        in: createdUserIds,
                      },
                    },
                  ]
                : []),

              ...(createdTransactionIds.length > 0
                ? [
                    {
                      entityId: {
                        in: createdTransactionIds,
                      },
                    },
                  ]
                : []),
            ],
          },
        });
      }

      /*
       * Transaction legs must be removed before
       * transactions.
       */
      if (createdTransactionIds.length > 0) {
        await prisma.transactionLeg.deleteMany({
          where: {
            transactionId: {
              in: createdTransactionIds,
            },
          },
        });

        /*
         * Ledger entries reference transactions
         * and accounts, so remove them first.
         */
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
       * Account balances must be removed before
       * accounts.
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
       * Remove user-dependent records before users.
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

        /*
         * Audit logs may also exist that are not
         * directly associated with a transaction.
         */
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
      role: "CUSTOMER" | "ADMIN",
    ) => {
      const user =
        await prisma.user.create({
          data: {
            name: `Deposit Service ${Date.now()}-${Math.random()}`,
            email: `deposit-service-${Date.now()}-${Math.random()}@example.com`,
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
    ) => {
      const account =
        await prisma.account.create({
          data: {
            userId,
            accountNumber:
              `ACC-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`,
            accountType: "SAVINGS",
            status: "ACTIVE",
          },
        });

      createdAccountIds.push(account.id);

      return account;
    };

    const buildAuthUser = (
      user: Awaited<ReturnType<typeof createUser>>,
    ) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    const createUniqueCurrencyCode = (): string => {
      const suffix =
        Math.floor(Math.random() * 90) + 10;

      return `T${suffix}`;
    };

    it("should prepare a deposit for the account owner", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(customer.id);

      const result =
        await prepareDeposit(
          buildAuthUser(customer),
          account.id,
          {
            amount: "5000.00",
            currency: "BDT",
          },
        );

      expect(
        result.account.id,
      ).toBe(account.id);

      expect(
        result.account.userId,
      ).toBe(customer.id);

      expect(
        result.account.status,
      ).toBe("ACTIVE");

      expect(
        result.currency.code,
      ).toBe("BDT");

      expect(
        result.amount.toString(),
      ).toBe("5000");
    });

    it("should allow ADMIN to prepare a deposit for any account", async () => {
      const admin =
        await createUser("ADMIN");

      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      const result =
        await prepareDeposit(
          buildAuthUser(admin),
          account.id,
          {
            amount: "1000.00",
            currency: "BDT",
          },
        );

      expect(
        result.account.id,
      ).toBe(account.id);

      expect(
        result.account.userId,
      ).toBe(customer.id);

      expect(
        result.currency.code,
      ).toBe("BDT");
    });

    it("should reject CUSTOMER access to another customer's account", async () => {
      const customerA =
        await createUser("CUSTOMER");

      const customerB =
        await createUser("CUSTOMER");

      const accountB =
        await createAccount(
          customerB.id,
        );

      await expect(
        prepareDeposit(
          buildAuthUser(customerA),
          accountB.id,
          {
            amount: "1000.00",
            currency: "BDT",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("should reject a missing account", async () => {
      const customer =
        await createUser("CUSTOMER");

      await expect(
        prepareDeposit(
          buildAuthUser(customer),
          "00000000-0000-0000-0000-000000000000",
          {
            amount: "1000.00",
            currency: "BDT",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
      });
    });

    it("should reject a frozen account", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      await prisma.account.update({
        where: {
          id: account.id,
        },
        data: {
          status: "FROZEN",
        },
      });

      await expect(
        prepareDeposit(
          buildAuthUser(customer),
          account.id,
          {
            amount: "1000.00",
            currency: "BDT",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "CONFLICT",
      });
    });

    it("should reject a closed account", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      await prisma.account.update({
        where: {
          id: account.id,
        },
        data: {
          status: "CLOSED",
        },
      });

      await expect(
        prepareDeposit(
          buildAuthUser(customer),
          account.id,
          {
            amount: "1000.00",
            currency: "BDT",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "CONFLICT",
      });
    });

    it("should reject an unsupported currency", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      await expect(
        prepareDeposit(
          buildAuthUser(customer),
          account.id,
          {
            amount: "1000.00",
            currency: "ZZZ",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
      });
    });

    it("should reject an inactive currency", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      const testCurrencyCode =
        createUniqueCurrencyCode();

      await prisma.currency.create({
        data: {
          code: testCurrencyCode,
          name: `Deposit Test Currency ${testCurrencyCode}`,
          symbol: "T",
          decimalPlaces: 2,
          isActive: false,
        },
      });

      try {
        await expect(
          prepareDeposit(
            buildAuthUser(customer),
            account.id,
            {
              amount: "1000.00",
              currency:
                testCurrencyCode,
            },
          ),
        ).rejects.toMatchObject({
          statusCode: 409,
          code: "CONFLICT",
        });

        /*
         * Normally there should be no transaction
         * for an inactive currency.
         *
         * But if a transaction was somehow created,
         * clean only records belonging to this
         * unique test currency.
         */
        const currencyTransactions =
          await prisma.transaction.findMany({
            where: {
              currencyCode:
                testCurrencyCode,
            },
            select: {
              id: true,
            },
          });

        const currencyTransactionIds =
          currencyTransactions.map(
            (transaction) =>
              transaction.id,
          );

        if (
          currencyTransactionIds.length >
          0
        ) {
          await prisma.auditLog.deleteMany({
            where: {
              entityId: {
                in: currencyTransactionIds,
              },
            },
          });

          await prisma.transactionLeg.deleteMany({
            where: {
              transactionId: {
                in: currencyTransactionIds,
              },
            },
          });

          await prisma.ledgerEntry.deleteMany({
            where: {
              transactionId: {
                in: currencyTransactionIds,
              },
            },
          });

          await prisma.transaction.deleteMany({
            where: {
              id: {
                in: currencyTransactionIds,
              },
            },
          });
        }
      } finally {
        await prisma.currency.delete({
          where: {
            code: testCurrencyCode,
          },
        });
      }
    });

    it("should reject an invalid account ID before starting the database transaction", async () => {
      const customer =
        await createUser("CUSTOMER");

      await expect(
        prepareDeposit(
          buildAuthUser(customer),
          "not-a-uuid",
          {
            amount: "1000.00",
            currency: "BDT",
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    });

    it("should not modify the account during deposit preparation", async () => {
      const customer =
        await createUser("CUSTOMER");

      const account =
        await createAccount(
          customer.id,
        );

      const before =
        await prisma.account.findUnique({
          where: {
            id: account.id,
          },
        });

      await prepareDeposit(
        buildAuthUser(customer),
        account.id,
        {
          amount: "5000.00",
          currency: "BDT",
        },
      );

      const after =
        await prisma.account.findUnique({
          where: {
            id: account.id,
          },
        });

      expect(after).not.toBeNull();

      expect(after?.status).toBe(
        before?.status,
      );

      expect(
        after?.accountNumber,
      ).toBe(
        before?.accountNumber,
      );
    });
  },
);