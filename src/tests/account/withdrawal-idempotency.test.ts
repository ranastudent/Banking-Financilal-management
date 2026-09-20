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
import { generateAccessToken } from "../../auth/utils/jwt";
import { hashPassword } from "../../auth/utils/password";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdIdempotencyRecordIds: string[] = [];

const createTestUser = async (
  role: UserRole = UserRole.CUSTOMER,
) => {
  const email =
    `withdrawal-idempotency-${Date.now()}-${Math.random()}@test.local`;

  const passwordHash =
    await hashPassword(
      "TestPassword123!",
    );

  const user =
    await prisma.user.create({
      data: {
        name: `Withdrawal Idempotency User ${Date.now()}-${Math.random()}`,
        email,
        passwordHash,
        role,
        status: UserStatus.ACTIVE,
      },
    });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const account =
    await prisma.account.create({
      data: {
        userId,
        accountNumber:
          `WIDEM-${Date.now()}-${Math.floor(
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

const getAccessToken = (user: {
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

const cleanup = async () => {
  if (
    createdIdempotencyRecordIds.length >
    0
  ) {
    await prisma.idempotencyRecord.deleteMany(
      {
        where: {
          id: {
            in: createdIdempotencyRecordIds,
          },
        },
      },
    );

    createdIdempotencyRecordIds.length = 0;
  }

  if (
    createdTransactionIds.length > 0
  ) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: {
          in: createdTransactionIds,
        },
        action: "WITHDRAWAL_CREATED",
      },
    });

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

    createdTransactionIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.idempotencyRecord.deleteMany(
      {
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      },
    );

    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany(
      {
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      },
    );
  }

  if (
    createdAccountIds.length > 0
  ) {
    await prisma.accountBalance.deleteMany(
      {
        where: {
          accountId: {
            in: createdAccountIds,
          },
        },
      },
    );

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
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
};

afterEach(async () => {
  await cleanup();
});

describe(
  "13.14 Withdrawal Idempotency",
  () => {
    it("should reject a withdrawal request without Idempotency-Key", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
        );

      const accessToken =
        getAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .send({
            amount: "500",
            currency: "BDT",
          });

      expect(response.status).toBe(
        400,
      );

      expect(
        response.body.success,
      ).toBe(false);

      expect(
        response.body.error.code,
      ).toBe("BAD_REQUEST");

      expect(
        response.body.error.message,
      ).toContain(
        "Idempotency-Key",
      );
    });

    it("should reject an empty Idempotency-Key", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
        );

      const accessToken =
        getAccessToken(user);

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            "   ",
          )
          .send({
            amount: "500",
            currency: "BDT",
          });

      expect(response.status).toBe(
        400,
      );

      expect(
        response.body.success,
      ).toBe(false);

      expect(
        response.body.error.code,
      ).toBe("BAD_REQUEST");

      expect(
        response.body.error.message,
      ).toContain(
        "Idempotency-Key",
      );
    });

    it("should create an idempotency record on the first successful withdrawal", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      const accessToken =
        getAccessToken(user);

      const idempotencyKey =
        `withdrawal-idem-first-${Date.now()}-${Math.random()}`;

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(response.status).toBe(
        200,
      );

      expect(
        response.body.success,
      ).toBe(true);

      const transactionId =
        response.body.data.transaction.id;

      createdTransactionIds.push(
        transactionId,
      );

      const idempotencyRecord =
        await prisma.idempotencyRecord.findUnique(
          {
            where: {
              key_userId: {
                key: idempotencyKey,
                userId: user.id,
              },
            },
          },
        );

      expect(
        idempotencyRecord,
      ).not.toBeNull();

      if (!idempotencyRecord) {
        throw new Error(
          "Expected idempotency record was not created",
        );
      }

      createdIdempotencyRecordIds.push(
        idempotencyRecord.id,
      );

      expect(
        idempotencyRecord.key,
      ).toBe(idempotencyKey);

      expect(
        idempotencyRecord.userId,
      ).toBe(user.id);

      expect(
        idempotencyRecord.requestHash,
      ).toMatch(
        /^[a-f0-9]{64}$/,
      );

      expect(
        idempotencyRecord.responseStatus,
      ).toBe(200);

      expect(
        idempotencyRecord.responseBody,
      ).not.toBeNull();

      expect(
        idempotencyRecord.expiresAt.getTime(),
      ).toBeGreaterThan(
        Date.now(),
      );
    });

    it("should return the previous response and not process the withdrawal twice", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      const accessToken =
        getAccessToken(user);

      const idempotencyKey =
        `withdrawal-idem-replay-${Date.now()}-${Math.random()}`;

      const payload = {
        amount: "500.00",
        currency: "BDT",
      };

      const firstResponse =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send(payload);

      expect(
        firstResponse.status,
      ).toBe(200);

      expect(
        firstResponse.body.success,
      ).toBe(true);

      const firstTransactionId =
        firstResponse.body.data.transaction.id;

      const secondResponse =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send(payload);

      expect(
        secondResponse.status,
      ).toBe(200);

      expect(
        secondResponse.body.success,
      ).toBe(true);

      expect(
        secondResponse.body.data.transaction.id,
      ).toBe(firstTransactionId);

      expect(
        secondResponse.body.data.amount,
      ).toBe(
        firstResponse.body.data.amount,
      );

      expect(
        secondResponse.body.data.accountId,
      ).toBe(
        firstResponse.body.data.accountId,
      );

      createdTransactionIds.push(
        firstTransactionId,
      );

      const balance =
        await prisma.accountBalance.findUnique(
          {
            where: {
              accountId_currencyCode: {
                accountId: account.id,
                currencyCode: "BDT",
              },
            },
          },
        );

      expect(balance).not.toBeNull();

      if (!balance) {
        throw new Error(
          "Expected account balance was not found",
        );
      }

      /*
       * 10000 - 500 = 9500
       *
       * The second request must NOT debit another 500.
       */
      expect(
        balance.availableBalance.eq(
          new Prisma.Decimal(
            "9500.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId: account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        1,
      );

      const ledgerEntries =
        await prisma.ledgerEntry.findMany(
          {
            where: {
              accountId: account.id,
              transactionId:
                firstTransactionId,
            },
          },
        );

      expect(
        ledgerEntries,
      ).toHaveLength(1);

      const auditLogs =
        await prisma.auditLog.findMany({
          where: {
            userId: user.id,
            entityId:
              firstTransactionId,
            action:
              "WITHDRAWAL_CREATED",
          },
        });

      expect(
        auditLogs,
      ).toHaveLength(1);
    });

    it("should reject reuse of the same key with a different request", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "10000.00",
        );

      const accessToken =
        getAccessToken(user);

      const idempotencyKey =
        `withdrawal-idem-conflict-${Date.now()}-${Math.random()}`;

      const firstResponse =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "500.00",
            currency: "BDT",
          });

      expect(
        firstResponse.status,
      ).toBe(200);

      const firstTransactionId =
        firstResponse.body.data.transaction.id;

      createdTransactionIds.push(
        firstTransactionId,
      );

      const secondResponse =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "700.00",
            currency: "BDT",
          });

      expect(
        secondResponse.status,
      ).toBe(409);

      expect(
        secondResponse.body.success,
      ).toBe(false);

      expect(
        secondResponse.body.error.code,
      ).toBe("CONFLICT");

      const balance =
        await prisma.accountBalance.findUnique(
          {
            where: {
              accountId_currencyCode: {
                accountId: account.id,
                currencyCode: "BDT",
              },
            },
          },
        );

      expect(balance).not.toBeNull();

      if (!balance) {
        throw new Error(
          "Expected account balance was not found",
        );
      }

      /*
       * Only the first 500 withdrawal happened.
       */
      expect(
        balance.availableBalance.eq(
          new Prisma.Decimal(
            "9500.00",
          ),
        ),
      ).toBe(true);

      const transactions =
        await prisma.transaction.findMany(
          {
            where: {
              sourceAccountId: account.id,
              type: "WITHDRAWAL",
            },
          },
        );

      expect(transactions).toHaveLength(
        1,
      );
    });

    it("should allow the same Idempotency-Key for different users", async () => {
      const userA =
        await createTestUser();

      const userB =
        await createTestUser();

      const accountA =
        await createTestAccount(
          userA.id,
          "1000.00",
        );

      const accountB =
        await createTestAccount(
          userB.id,
          "2000.00",
        );

      const tokenA =
        getAccessToken(userA);

      const tokenB =
        getAccessToken(userB);

      const idempotencyKey =
        `withdrawal-idem-user-scope-${Date.now()}-${Math.random()}`;

      const responseA =
        await request(app)
          .post(
            `/api/v1/accounts/${accountA.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${tokenA}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "100.00",
            currency: "BDT",
          });

      expect(
        responseA.status,
      ).toBe(200);

      const transactionA =
        responseA.body.data.transaction.id;

      createdTransactionIds.push(
        transactionA,
      );

      const responseB =
        await request(app)
          .post(
            `/api/v1/accounts/${accountB.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${tokenB}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "100.00",
            currency: "BDT",
          });

      expect(
        responseB.status,
      ).toBe(200);

      const transactionB =
        responseB.body.data.transaction.id;

      createdTransactionIds.push(
        transactionB,
      );

      expect(
        transactionB,
      ).not.toBe(
        transactionA,
      );

      const records =
        await prisma.idempotencyRecord.findMany(
          {
            where: {
              key: idempotencyKey,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        );

      expect(records).toHaveLength(2);

      expect(
        records[0]?.userId,
      ).toBe(userA.id);

      expect(
        records[1]?.userId,
      ).toBe(userB.id);
    });

    it("should store the original response body and status", async () => {
      const user =
        await createTestUser();

      const account =
        await createTestAccount(
          user.id,
          "5000.00",
        );

      const accessToken =
        getAccessToken(user);

      const idempotencyKey =
        `withdrawal-idem-response-${Date.now()}-${Math.random()}`;

      const response =
        await request(app)
          .post(
            `/api/v1/accounts/${account.id}/withdrawals`,
          )
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .set(
            "Idempotency-Key",
            idempotencyKey,
          )
          .send({
            amount: "250.00",
            currency: "BDT",
          });

      expect(
        response.status,
      ).toBe(200);

      const transactionId =
        response.body.data.transaction.id;

      createdTransactionIds.push(
        transactionId,
      );

      const record =
        await prisma.idempotencyRecord.findUnique(
          {
            where: {
              key_userId: {
                key: idempotencyKey,
                userId: user.id,
              },
            },
          },
        );

      expect(record).not.toBeNull();

      if (!record) {
        throw new Error(
          "Expected idempotency record was not found",
        );
      }

      createdIdempotencyRecordIds.push(
        record.id,
      );

      expect(
        record.responseStatus,
      ).toBe(200);

      const responseBody =
        record.responseBody as {
          message?: unknown;
          accountId?: unknown;
          amount?: unknown;
          currency?: unknown;
          transaction?: {
            id?: unknown;
          };
          ledgerEntry?: {
            id?: unknown;
          };
          auditLog?: {
            id?: unknown;
          };
        };

      expect(
        responseBody.message,
      ).toBe(
        "Withdrawal transaction created successfully",
      );

      expect(
        responseBody.accountId,
      ).toBe(account.id);

      expect(
        responseBody.amount,
      ).toBe("250");

      expect(
        responseBody.currency,
      ).toBe("BDT");

      expect(
        responseBody.transaction?.id,
      ).toBe(transactionId);

      expect(
        responseBody.ledgerEntry?.id,
      ).toBeDefined();

      expect(
        responseBody.auditLog?.id,
      ).toBeDefined();
    });
  },
);