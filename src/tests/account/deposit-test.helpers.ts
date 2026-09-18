import { Prisma, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { generateAccessToken } from "../../auth/utils/jwt";
import type { AuthUser } from "../../types/auth";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const uniqueSuffix = (): string => {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

export const createDepositTestUser = async (
  role: UserRole = UserRole.CUSTOMER,
) => {
  const suffix = uniqueSuffix();

  const user = await prisma.user.create({
    data: {
      name: `Deposit Test User ${suffix}`,
      email: `deposit-test-${suffix}@test.local`,
      passwordHash: await hashPassword("TestPassword123!"),
      role,
      status: UserStatus.ACTIVE,
    },
  });

  createdUserIds.push(user.id);

  return user;
};

export const createDepositTestAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const suffix = uniqueSuffix();

  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `DTEST-${suffix}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  await prisma.accountBalance.create({
    data: {
      accountId: account.id,
      currencyCode: "BDT",
      availableBalance: new Prisma.Decimal(balance),
      lockedBalance: new Prisma.Decimal("0"),
    },
  });

  return account;
};

export const createDepositAuthUser = (user: {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}): AuthUser => {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };
};

export const createDepositAccessToken = (user: {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}): string => {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });
};

export const getDepositBalance = async (
  accountId: string,
  currencyCode = "BDT",
) => {
  return prisma.accountBalance.findUnique({
    where: {
      accountId_currencyCode: {
        accountId,
        currencyCode,
      },
    },
  });
};

export const getDepositTransactions = async (
  accountId: string,
) => {
  return prisma.transaction.findMany({
    where: {
      OR: [
        {
          destinationAccountId: accountId,
        },
        {
          sourceAccountId: accountId,
        },
      ],
      type: "DEPOSIT",
    },
    orderBy: {
      createdAt: "asc",
    },
  });
};

export const getDepositLedgerEntries = async (
  accountId: string,
) => {
  return prisma.ledgerEntry.findMany({
    where: {
      accountId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
};

export const getDepositAuditLogs = async (
  userId: string,
) => {
  return prisma.auditLog.findMany({
    where: {
      userId,
      action: "DEPOSIT_CREATED",
    },
    orderBy: {
      createdAt: "asc",
    },
  });
};

export const getDepositIdempotencyRecord = async (
  userId: string,
  key: string,
) => {
  return prisma.idempotencyRecord.findUnique({
    where: {
      key_userId: {
        key,
        userId,
      },
    },
  });
};

export const cleanupDepositTestData = async (): Promise<void> => {
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
};

export const depositKey = (prefix = "deposit-test"): string => {
  return `${prefix}-${uniqueSuffix()}`;
};