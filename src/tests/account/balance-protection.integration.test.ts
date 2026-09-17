import request from "supertest";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  UserRole,
  UserStatus,
} from "@prisma/client";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async (
  name: string,
  role: "CUSTOMER" | "ADMIN" = "CUSTOMER",
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email: `balance-protection-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
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

const createAccountWithBalance = async (
  userId: string,
  accountNumberPrefix: string,
  availableBalance = "10000.00",
  lockedBalance = "500.00",
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `${accountNumberPrefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
      balances: {
        create: {
          currencyCode: "BDT",
          availableBalance,
          lockedBalance,
        },
      },
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const getBalance = async (accountId: string) => {
  return prisma.accountBalance.findFirst({
    where: {
      accountId,
      currencyCode: "BDT",
    },
  });
};

beforeEach(() => {
  /*
   * This test file uses scoped cleanup.
   *
   * Do not globally delete users/accounts here because other
   * test files may be using the same database.
   */
});

afterAll(async () => {
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

  await prisma.$disconnect();
});

describe("11.4.4 Balance Protection Integration/Security", () => {
  it("should reject balance fields during account creation", async () => {
    const customer = await createTestUser(
      "Balance Protection Creation User",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
        balance: 999999,
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject balance fields during account status update", async () => {
    const customer = await createTestUser(
      "Balance Protection Status User",
    );

    const account = await createAccountWithBalance(
      customer.id,
      "STATUS",
    );

    const accessToken = createAccessToken(customer);

    const before = await getBalance(account.id);

    expect(before).not.toBeNull();

    const response = await request(app)
      .patch(`/api/v1/accounts/${account.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "FROZEN",
        balance: 999999,
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const after = await getBalance(account.id);

    expect(after).not.toBeNull();

    expect(after?.availableBalance.toString()).toBe(
      before?.availableBalance.toString(),
    );

    expect(after?.lockedBalance.toString()).toBe(
      before?.lockedBalance.toString(),
    );
  });

  it("should not modify balance during deposit authorization", async () => {
    const customer = await createTestUser(
      "Balance Protection Deposit User",
    );

    const account = await createAccountWithBalance(
      customer.id,
      "DEPOSIT",
    );

    const accessToken = createAccessToken(customer);

    const before = await getBalance(account.id);

    expect(before).not.toBeNull();

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: 5000,
        balance: 999999,
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const after = await getBalance(account.id);

    expect(after).not.toBeNull();

    expect(after?.availableBalance.toString()).toBe(
      before?.availableBalance.toString(),
    );

    expect(after?.lockedBalance.toString()).toBe(
      before?.lockedBalance.toString(),
    );
  });

  it("should not modify balance during withdrawal authorization", async () => {
    const customer = await createTestUser(
      "Balance Protection Withdrawal User",
    );

    const account = await createAccountWithBalance(
      customer.id,
      "WITHDRAWAL",
    );

    const accessToken = createAccessToken(customer);

    const before = await getBalance(account.id);

    expect(before).not.toBeNull();

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: 2500,
        balance: 999999,
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const after = await getBalance(account.id);

    expect(after).not.toBeNull();

    expect(after?.availableBalance.toString()).toBe(
      before?.availableBalance.toString(),
    );

    expect(after?.lockedBalance.toString()).toBe(
      before?.lockedBalance.toString(),
    );
  });

  it("should not modify either balance during transfer authorization", async () => {
    const sourceUser = await createTestUser(
      "Balance Protection Transfer Source",
    );

    const destinationUser = await createTestUser(
      "Balance Protection Transfer Destination",
    );

    const sourceAccount = await createAccountWithBalance(
      sourceUser.id,
      "TRANSFER-SOURCE",
      "20000.00",
      "1000.00",
    );

    const destinationAccount = await createAccountWithBalance(
      destinationUser.id,
      "TRANSFER-DESTINATION",
      "15000.00",
      "750.00",
    );

    const accessToken = createAccessToken(sourceUser);

    const sourceBefore = await getBalance(
      sourceAccount.id,
    );

    const destinationBefore = await getBalance(
      destinationAccount.id,
    );

    expect(sourceBefore).not.toBeNull();
    expect(destinationBefore).not.toBeNull();

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: 4000,
        balance: 999999,
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const sourceAfter = await getBalance(
      sourceAccount.id,
    );

    const destinationAfter = await getBalance(
      destinationAccount.id,
    );

    expect(sourceAfter).not.toBeNull();
    expect(destinationAfter).not.toBeNull();

    expect(sourceAfter?.availableBalance.toString()).toBe(
      sourceBefore?.availableBalance.toString(),
    );

    expect(sourceAfter?.lockedBalance.toString()).toBe(
      sourceBefore?.lockedBalance.toString(),
    );

    expect(
      destinationAfter?.availableBalance.toString(),
    ).toBe(
      destinationBefore?.availableBalance.toString(),
    );

    expect(
      destinationAfter?.lockedBalance.toString(),
    ).toBe(
      destinationBefore?.lockedBalance.toString(),
    );
  });

  it("should prevent a CUSTOMER from using another customer's account to change authorization state", async () => {
  const customerA = await createTestUser(
    "Balance Protection Customer A",
  );

  const customerB = await createTestUser(
    "Balance Protection Customer B",
  );

  const accountB = await createAccountWithBalance(
    customerB.id,
    "OWNERSHIP",
  );

  const accessToken = createAccessToken(customerA);

  const before = await getBalance(accountB.id);

  expect(before).not.toBeNull();

  const response = await request(app)
    .patch(`/api/v1/accounts/${accountB.id}/status`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      status: "FROZEN",
    });

  expect(response.status).toBe(403);
  expect(response.body.success).toBe(false);

  const accountAfter = await prisma.account.findUnique({
    where: {
      id: accountB.id,
    },
    select: {
      status: true,
    },
  });

  const after = await getBalance(accountB.id);

  expect(accountAfter?.status).toBe("ACTIVE");

  expect(after).not.toBeNull();

  expect(after?.availableBalance.toString()).toBe(
    before?.availableBalance.toString(),
  );

  expect(after?.lockedBalance.toString()).toBe(
    before?.lockedBalance.toString(),
  );
  });

  it("should prevent unauthenticated balance-related account mutation", async () => {
    const customer = await createTestUser(
      "Balance Protection Unauthenticated User",
    );

    const account = await createAccountWithBalance(
      customer.id,
      "UNAUTHENTICATED",
    );

    const before = await getBalance(account.id);

    expect(before).not.toBeNull();

    const response = await request(app)
      .patch(`/api/v1/accounts/${account.id}/status`)
      .send({
        status: "FROZEN",
        availableBalance: 999999,
        lockedBalance: 999999,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);

    const after = await getBalance(account.id);

    expect(after).not.toBeNull();

    expect(after?.availableBalance.toString()).toBe(
      before?.availableBalance.toString(),
    );

    expect(after?.lockedBalance.toString()).toBe(
      before?.lockedBalance.toString(),
    );
  });
});