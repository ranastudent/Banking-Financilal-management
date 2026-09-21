import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  Prisma,
  UserRole,
  UserStatus,
} from "@prisma/client";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { generateAccessToken, generateRefreshToken, } from "../../auth/utils/jwt";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createUser = async (
  role: UserRole = UserRole.CUSTOMER,
) => {
  const user = await prisma.user.create({
    data: {
      name: `Withdrawal Integration ${Date.now()}-${Math.random()}`,
      email: `withdrawal-integration-${Date.now()}-${Math.random()}@test.local`,
      passwordHash:
        await hashPassword("TestPassword123!"),
      role,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber:
        `WINT-${Date.now()}-${Math.floor(
          Math.random() * 100000,
        )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  await prisma.accountBalance.create({
    data: {
      accountId: account.id,
      currencyCode: "BDT",
      availableBalance:
        new Prisma.Decimal(balance),
      lockedBalance:
        new Prisma.Decimal("0"),
    },
  });

  return account;
};

const createAccessToken = (user: {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}) => {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });
};

const getBalance = async (
  accountId: string,
) => {
  return prisma.accountBalance.findUnique({
    where: {
      accountId_currencyCode: {
        accountId,
        currencyCode: "BDT",
      },
    },
  });
};

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.ledgerEntry.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transaction.deleteMany({
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
    });

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

    createdUserIds.length = 0;
  }
});

describe(
  "13.16 Withdrawal Integration + Security",
  () => {
    it("should complete a CUSTOMER withdrawal through the full HTTP flow", async () => {
      const customer =
        await createUser(
          UserRole.CUSTOMER,
        );

      const account =
        await createAccount(
          customer.id,
          "10000.00",
        );

      const token =
        createAccessToken(customer);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-int-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(200);

      expect(
        response.body.success,
      ).toBe(true);

      expect(
        response.body.requestId,
      ).toBeDefined();

      expect(
        response.body.data.accountId,
      ).toBe(account.id);

      expect(
        response.body.data.currency,
      ).toBe("BDT");

      expect(
        response.body.data.amount,
      ).toBe("500");

      expect(
        response.body.data.balance.balanceBefore,
      ).toBe("10000");

      expect(
        response.body.data.balance.balanceAfter,
      ).toBe("9500");

      expect(
        response.body.data.transaction.type,
      ).toBe("WITHDRAWAL");

      expect(
        response.body.data.transaction.status,
      ).toBe("PENDING");

      expect(
        response.body.data.ledgerEntry.entryType,
      ).toBe("DEBIT");

      expect(
        response.body.data.auditLog.action,
      ).toBe("WITHDRAWAL_CREATED");

      const balance =
        await getBalance(
          account.id,
        );

      expect(balance).not.toBeNull();

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "9500.00",
          ),
        ),
      ).toBe(true);
    });

    it("should reject CUSTOMER withdrawal from another customer's account", async () => {
      const customerA =
        await createUser(
          UserRole.CUSTOMER,
        );

      const customerB =
        await createUser(
          UserRole.CUSTOMER,
        );

      const accountB =
        await createAccount(
          customerB.id,
          "10000.00",
        );

      const token =
        createAccessToken(
          customerA,
        );

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${accountB.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-owner-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        403,
      );

      expect(
        response.body.success,
      ).toBe(false);

      expect(
        response.body.error.code,
      ).toBe("FORBIDDEN");

      const balance =
        await getBalance(
          accountB.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);
    });

    it("should allow ADMIN to withdraw from any account", async () => {
      const admin =
        await createUser(
          UserRole.ADMIN,
        );

      const customer =
        await createUser(
          UserRole.CUSTOMER,
        );

      const account =
        await createAccount(
          customer.id,
          "10000.00",
        );

      const token =
        createAccessToken(admin);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-admin-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        200,
      );

      expect(
        response.body.data.userRole,
      ).toBe("ADMIN");

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "9500.00",
          ),
        ),
      ).toBe(true);
    });

    it("should reject SUPPORT", async () => {
      const support =
        await createUser(
          UserRole.SUPPORT,
        );

      const customer =
        await createUser(
          UserRole.CUSTOMER,
        );

      const account =
        await createAccount(
          customer.id,
          "10000.00",
        );

      const token =
        createAccessToken(support);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-support-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        403,
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);
    });

    it("should reject AUDITOR", async () => {
      const auditor =
        await createUser(
          UserRole.AUDITOR,
        );

      const customer =
        await createUser(
          UserRole.CUSTOMER,
        );

      const account =
        await createAccount(
          customer.id,
          "10000.00",
        );

      const token =
        createAccessToken(auditor);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-auditor-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        403,
      );
    });

    it("should reject an unauthenticated request", async () => {
      const user =
        await createUser();

      const account =
        await createAccount(
          user.id,
          "10000.00",
        );

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-no-auth-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        401,
      );

      expect(
        response.body.error.code,
      ).toBe("UNAUTHORIZED");
    });

    it("should reject a refresh token", async () => {
        const user =
            await createUser();

        const account =
            await createAccount(
            user.id,
            "10000.00",
            );

        const refreshToken =
            generateRefreshToken({
            id: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            });

        const response =
            await request(app)
            .post(
                `/api/v1/accounts/${account.id}/withdrawals`,
            )
            .set(
                "Authorization",
                `Bearer ${refreshToken}`,
            )
            .set(
                "Idempotency-Key",
                `withdrawal-refresh-${Date.now()}-${Math.random()}`,
            )
            .send({
                amount: "500.00",
                currency: "BDT",
            });

        expect(response.status).toBe(
            401,
        );

        expect(
            response.body.success,
        ).toBe(false);

        expect(
            response.body.error.code,
        ).toBe("UNAUTHORIZED");

        const balance =
            await getBalance(
            account.id,
            );

        expect(balance).not.toBeNull();

        expect(
            balance?.availableBalance.eq(
            new Prisma.Decimal(
                "10000.00",
            ),
            ),
        ).toBe(true);
    });

    it("should reject invalid withdrawal input", async () => {
      const user =
        await createUser();

      const account =
        await createAccount(
          user.id,
          "10000.00",
        );

      const token =
        createAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-invalid-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "-500",
            currency: "BDT",
          });

      expect(response.status).toBe(
        400,
      );
    });

    it("should reject a nonexistent account", async () => {
      const user =
        await createUser();

      const token =
        createAccessToken(user);

      const missingAccountId =
        "00000000-0000-0000-0000-000000000000";

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${missingAccountId}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-missing-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        404,
      );
    });

    it("should reject insufficient balance without modifying balance", async () => {
      const user =
        await createUser();

      const account =
        await createAccount(
          user.id,
          "100.00",
        );

      const token =
        createAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-insufficient-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        409,
      );

      expect(
        response.body.error.code,
      ).toBe(
        "INSUFFICIENT_BALANCE",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "100.00",
          ),
        ),
      ).toBe(true);
    });

    it("should reject an amount above the transaction limit", async () => {
      const user =
        await createUser();

      const account =
        await createAccount(
          user.id,
          "100000.00",
        );

      const token =
        createAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .set(
            "Idempotency-Key",
            `withdrawal-limit-${Date.now()}-${Math.random()}`,
          )
          .send({
            amount: "50001.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        409,
      );

      expect(
        response.body.error.code,
      ).toBe(
        "TRANSACTION_LIMIT_EXCEEDED",
      );

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "100000.00",
          ),
        ),
      ).toBe(true);
    });

    it("should reject a withdrawal without Idempotency-Key", async () => {
      const user =
        await createUser();

      const account =
        await createAccount(
          user.id,
          "10000.00",
        );

      const token =
        createAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        400,
      );

      expect(
        response.body.error.code,
      ).toBe("BAD_REQUEST");

      const balance =
        await getBalance(
          account.id,
        );

      expect(
        balance?.availableBalance.eq(
          new Prisma.Decimal(
            "10000.00",
          ),
        ),
      ).toBe(true);
    });
  },
);