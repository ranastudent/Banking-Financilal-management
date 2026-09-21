import { Prisma, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";
import { generateAccessToken } from "../auth/utils/jwt";

const K6_EMAIL = "k6-performance@test.local";
const K6_PASSWORD = "K6-TestPassword-2026!";

const INITIAL_BALANCE = new Prisma.Decimal(
  "100000.00",
);

const K6_ACCOUNT_NUMBERS = [
  "K6-PERFORMANCE-001",
  "K6-PERFORMANCE-002",
  "K6-PERFORMANCE-003",
  "K6-PERFORMANCE-004",
  "K6-PERFORMANCE-005",
];

const main = async (): Promise<void> => {
  let user = await prisma.user.findUnique({
    where: {
      email: K6_EMAIL,
    },
  });

  if (user) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new Error(
        `Existing k6 user has unexpected role: ${user.role}`,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new Error(
        `Existing k6 user is not ACTIVE: ${user.status}`,
      );
    }
  } else {
    user = await prisma.user.create({
      data: {
        name: "K6 Performance Test User",
        email: K6_EMAIL,
        passwordHash: await hashPassword(K6_PASSWORD),
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });
  }

  const accounts: Array<{
    id: string;
    accountNumber: string;
  }> = [];

  for (const accountNumber of K6_ACCOUNT_NUMBERS) {
    let account = await prisma.account.findUnique({
      where: {
        accountNumber,
      },
    });

    if (account) {
      if (account.userId !== user.id) {
        throw new Error(
          `K6 account ${accountNumber} belongs to a different user.`,
        );
      }

      if (account.status !== "ACTIVE") {
        account = await prisma.account.update({
          where: {
            id: account.id,
          },
          data: {
            status: "ACTIVE",
          },
        });
      }
    } else {
      account = await prisma.account.create({
        data: {
          userId: user.id,
          accountNumber,
          accountType: "SAVINGS",
          status: "ACTIVE",
        },
      });
    }

    await prisma.accountBalance.upsert({
      where: {
        accountId_currencyCode: {
          accountId: account.id,
          currencyCode: "BDT",
        },
      },
      update: {},
      create: {
        accountId: account.id,
        currencyCode: "BDT",
        availableBalance: INITIAL_BALANCE,
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    accounts.push({
      id: account.id,
      accountNumber: account.accountNumber,
    });
  }

  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  console.log("");
  console.log(
    "K6 multi-account performance test data is ready.",
  );
  console.log("");

  console.log(`User email: ${user.email}`);
  console.log(`User role: ${user.role}`);
  console.log(`User status: ${user.status}`);

  console.log("");
  console.log("Accounts:");

  for (const account of accounts) {
    console.log(
      `${account.accountNumber} -> ${account.id}`,
    );
  }

  console.log("");
  console.log("Currency: BDT");
  console.log("Balance: existing balance preserved");
  console.log("");

  console.log("K6 access token:");
  console.log(accessToken);

  console.log("");
};

main()
  .catch((error: unknown) => {
    console.error(
      "Failed to prepare K6 test data:",
      error,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });