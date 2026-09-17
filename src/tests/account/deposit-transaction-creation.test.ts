import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../../config/prisma";
import { prepareDeposit } from "../../transaction/services/deposit.service";

describe("12.5 Deposit Transaction Creation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
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
    }

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

    createdTransactionIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async (
    role: "CUSTOMER" | "ADMIN",
  ) => {
    const user = await prisma.user.create({
      data: {
        name: `Deposit Transaction ${Date.now()}`,
        email: `deposit-transaction-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role,
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

  it("should create a PENDING deposit transaction", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const result = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "5000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(result.transaction.id).toEqual(
      expect.any(String),
    );

    expect(result.transaction.reference).toMatch(
      /^DEP-/,
    );

    expect(result.transaction.type).toBe(
      "DEPOSIT",
    );

    expect(result.transaction.status).toBe(
      "PENDING",
    );

    expect(result.transaction.amount).toBe(
      "5000",
    );

    expect(result.transaction.currencyCode).toBe(
      "BDT",
    );

    expect(result.transaction.provider).toBe(
      "INTERNAL",
    );

    expect(
      result.transaction.destinationAccountId,
    ).toBe(account.id);
  });

  it("should store the transaction amount exactly as a decimal value", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const result = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "1234.56789012",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const transaction =
      await prisma.transaction.findUnique({
        where: {
          id: result.transaction.id,
        },
      });

    expect(transaction).not.toBeNull();
    expect(transaction?.amount.toString()).toBe(
      "1234.56789012",
    );
  });

  it("should associate the transaction with the destination account", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const result = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "2000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const transaction =
      await prisma.transaction.findUnique({
        where: {
          id: result.transaction.id,
        },
        select: {
          destinationAccountId: true,
          sourceAccountId: true,
        },
      });

    expect(
      transaction?.destinationAccountId,
    ).toBe(account.id);

    expect(transaction?.sourceAccountId).toBeNull();
  });

  it("should not create a transaction for an unauthorized customer", async () => {
    const customerA = await createUser("CUSTOMER");
    const customerB = await createUser("CUSTOMER");

    const accountB = await createAccount(
      customerB.id,
    );

    await expect(
      prepareDeposit(
        {
          id: customerA.id,
          email: customerA.email,
          role: customerA.role,
          status: customerA.status,
        },
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

    const transactionCount =
      await prisma.transaction.count({
        where: {
          destinationAccountId: accountB.id,
        },
      });

    expect(transactionCount).toBe(0);
  });

  it("should not create a transaction for an inactive account", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

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
        {
          id: customer.id,
          email: customer.email,
          role: customer.role,
          status: customer.status,
        },
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

    const transactionCount =
      await prisma.transaction.count({
        where: {
          destinationAccountId: account.id,
        },
      });

    expect(transactionCount).toBe(0);
  });

  it("should create a unique transaction reference", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const first = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "1000.00",
        currency: "BDT",
      },
    );

    const second = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "2000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      first.transaction.id,
      second.transaction.id,
    );

    expect(first.transaction.reference).not.toBe(
      second.transaction.reference,
    );
  });

  it("should not modify the account balance when only the transaction is created", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const result = await prepareDeposit(
      {
        id: customer.id,
        email: customer.email,
        role: customer.role,
        status: customer.status,
      },
      account.id,
      {
        amount: "5000.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    const balanceCount =
      await prisma.accountBalance.count({
        where: {
          accountId: account.id,
        },
      });

    expect(balanceCount).toBe(0);
  });
});