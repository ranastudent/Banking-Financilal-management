import { Prisma, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";
import { generateAccessToken } from "../auth/utils/jwt";

const K6_EMAIL = "k6-integrity@test.local";
const K6_PASSWORD = "K6-IntegrityPassword-2026!";
const K6_ACCOUNT_NUMBER = "K6-INTEGRITY-001";

const INITIAL_BALANCE = new Prisma.Decimal(
  "100000.00",
);

const main = async (): Promise<void> => {
  let user = await prisma.user.findUnique({
    where: {
      email: K6_EMAIL,
    },
  });

  if (user) {
    if (user.role !== UserRole.CUSTOMER) {
      throw new Error(
        `Existing integrity user has unexpected role: ${user.role}`,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new Error(
        `Existing integrity user is not ACTIVE: ${user.status}`,
      );
    }
  } else {
    user = await prisma.user.create({
      data: {
        name: "K6 Integrity Test User",
        email: K6_EMAIL,
        passwordHash: await hashPassword(K6_PASSWORD),
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });
  }

  let account = await prisma.account.findUnique({
    where: {
      accountNumber: K6_ACCOUNT_NUMBER,
    },
  });

  if (account) {
    if (account.userId !== user.id) {
      throw new Error(
        "K6 integrity account belongs to a different user.",
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
        accountNumber: K6_ACCOUNT_NUMBER,
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
    update: {
      availableBalance: INITIAL_BALANCE,
      lockedBalance: new Prisma.Decimal("0"),
    },
    create: {
      accountId: account.id,
      currencyCode: "BDT",
      availableBalance: INITIAL_BALANCE,
      lockedBalance: new Prisma.Decimal("0"),
    },
  });

  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  console.log("");
  console.log(
    "K6 financial integrity test data is ready.",
  );
  console.log("");

  console.log(`User email: ${user.email}`);
  console.log(`User role: ${user.role}`);
  console.log(`User status: ${user.status}`);
  console.log(`Account number: ${account.accountNumber}`);
  console.log(`Account ID: ${account.id}`);
  console.log("Currency: BDT");
  console.log("Initial balance: 100000.00");

  console.log("");
  console.log("K6 access token:");
  console.log(accessToken);
  console.log("");
};

main()
  .catch((error: unknown) => {
    console.error(
      "Failed to prepare K6 integrity test data:",
      error,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });