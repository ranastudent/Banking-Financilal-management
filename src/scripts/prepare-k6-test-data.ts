import { Prisma, UserRole, UserStatus } from "@prisma/client";

import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";
import { generateAccessToken } from "../auth/utils/jwt";

const K6_EMAIL = "k6-performance@test.local";
const K6_PASSWORD = "K6-TestPassword-2026!";

const K6_RECEIVER_EMAILS = [
  "k6-performance-receiver-001@test.local",
  "k6-performance-receiver-002@test.local",
  "k6-performance-receiver-003@test.local",
  "k6-performance-receiver-004@test.local",
  "k6-performance-receiver-005@test.local",
];

const K6_RECEIVER_PASSWORD = "K6-ReceiverPassword-2026!";

const INITIAL_BALANCE = new Prisma.Decimal(
  "100000.00",
);

const K6_RECEIVER_INITIAL_BALANCE = new Prisma.Decimal(
  "0",
);

const K6_ACCOUNT_NUMBERS = [
  "K6-PERFORMANCE-001",
  "K6-PERFORMANCE-002",
  "K6-PERFORMANCE-003",
  "K6-PERFORMANCE-004",
  "K6-PERFORMANCE-005",
];

const K6_RECEIVER_ACCOUNT_NUMBERS = [
  "K6-PERFORMANCE-RECEIVER-001",
  "K6-PERFORMANCE-RECEIVER-002",
  "K6-PERFORMANCE-RECEIVER-003",
  "K6-PERFORMANCE-RECEIVER-004",
  "K6-PERFORMANCE-RECEIVER-005",
];

const main = async (): Promise<void> => {
  // --------------------------------------------------
  // K6 sender user
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Sender accounts
  // --------------------------------------------------

  const senderAccounts: Array<{
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
          `K6 sender account ${accountNumber} belongs to a different user.`,
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

    senderAccounts.push({
      id: account.id,
      accountNumber: account.accountNumber,
    });
  }

  // --------------------------------------------------
  // Five dedicated receiver users + accounts
  // --------------------------------------------------

  const receiverAccounts: Array<{
    id: string;
    accountNumber: string;
    email: string;
  }> = [];

  for (let index = 0; index < 5; index += 1) {
    const receiverEmail = K6_RECEIVER_EMAILS[index];
    const receiverAccountNumber =
      K6_RECEIVER_ACCOUNT_NUMBERS[index];

    if (!receiverEmail || !receiverAccountNumber) {
      throw new Error(
        `Missing receiver configuration at index ${index}`,
      );
    }

    let receiverUser = await prisma.user.findUnique({
      where: {
        email: receiverEmail,
      },
    });

    if (receiverUser) {
      if (receiverUser.role !== UserRole.CUSTOMER) {
        throw new Error(
          `Existing k6 receiver ${receiverEmail} has unexpected role: ${receiverUser.role}`,
        );
      }

      if (receiverUser.status !== UserStatus.ACTIVE) {
        throw new Error(
          `Existing k6 receiver ${receiverEmail} is not ACTIVE: ${receiverUser.status}`,
        );
      }
    } else {
      receiverUser = await prisma.user.create({
        data: {
          name: `K6 Performance Receiver ${String(index + 1).padStart(3, "0")}`,
          email: receiverEmail,
          passwordHash: await hashPassword(
            K6_RECEIVER_PASSWORD,
          ),
          role: UserRole.CUSTOMER,
          status: UserStatus.ACTIVE,
        },
      });
    }

    let receiverAccount =
      await prisma.account.findUnique({
        where: {
          accountNumber: receiverAccountNumber,
        },
      });

    if (receiverAccount) {
      if (receiverAccount.userId !== receiverUser.id) {
        throw new Error(
          `K6 receiver account ${receiverAccountNumber} belongs to a different user.`,
        );
      }

      if (receiverAccount.status !== "ACTIVE") {
        receiverAccount = await prisma.account.update({
          where: {
            id: receiverAccount.id,
          },
          data: {
            status: "ACTIVE",
          },
        });
      }
    } else {
      receiverAccount = await prisma.account.create({
        data: {
          userId: receiverUser.id,
          accountNumber: receiverAccountNumber,
          accountType: "SAVINGS",
          status: "ACTIVE",
        },
      });
    }

    await prisma.accountBalance.upsert({
      where: {
        accountId_currencyCode: {
          accountId: receiverAccount.id,
          currencyCode: "BDT",
        },
      },
      update: {},
      create: {
        accountId: receiverAccount.id,
        currencyCode: "BDT",
        availableBalance:
          K6_RECEIVER_INITIAL_BALANCE,
        lockedBalance: new Prisma.Decimal("0"),
      },
    });

    receiverAccounts.push({
      id: receiverAccount.id,
      accountNumber: receiverAccount.accountNumber,
      email: receiverUser.email,
    });
  }

  // --------------------------------------------------
  // Generate performance-test JWT
  // --------------------------------------------------

  const accessToken = generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  // --------------------------------------------------
  // Output
  // --------------------------------------------------

  console.log("");
  console.log(
    "K6 multi-receiver performance test data is ready.",
  );
  console.log("");

  console.log(`User email: ${user.email}`);
  console.log(`User role: ${user.role}`);
  console.log(`User status: ${user.status}`);

  console.log("");
  console.log("Sender accounts:");

  for (const account of senderAccounts) {
    console.log(
      `${account.accountNumber} -> ${account.id}`,
    );
  }

  console.log("");
  console.log("Receiver accounts:");

  for (const account of receiverAccounts) {
    console.log(
      `${account.accountNumber} -> ${account.id} (${account.email})`,
    );
  }

  console.log("");
  console.log("Currency: BDT");
  console.log(
    "Sender balance: existing balance preserved",
  );
  console.log(
    "Receiver balance: 0 BDT",
  );

  console.log("");
  console.log("Expected K6 mapping:");
  console.log(
    "K6-PERFORMANCE-001 -> K6-PERFORMANCE-RECEIVER-001",
  );
  console.log(
    "K6-PERFORMANCE-002 -> K6-PERFORMANCE-RECEIVER-002",
  );
  console.log(
    "K6-PERFORMANCE-003 -> K6-PERFORMANCE-RECEIVER-003",
  );
  console.log(
    "K6-PERFORMANCE-004 -> K6-PERFORMANCE-RECEIVER-004",
  );
  console.log(
    "K6-PERFORMANCE-005 -> K6-PERFORMANCE-RECEIVER-005",
  );

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

