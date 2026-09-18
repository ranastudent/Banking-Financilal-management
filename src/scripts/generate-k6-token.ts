import { prisma } from "../config/prisma";
import { generateAccessToken } from "../auth/utils/jwt";

const main = async (): Promise<void> => {
  const accountId = process.env.K6_ACCOUNT_ID;

  if (!accountId) {
    throw new Error(
      "K6_ACCOUNT_ID environment variable is required",
    );
  }

  const account = await prisma.account.findUnique({
    where: {
      id: accountId,
    },
    select: {
      id: true,
      status: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
        },
      },
    },
  });

  if (!account) {
    throw new Error(
      "K6 account was not found",
    );
  }

  if (account.status !== "ACTIVE") {
    throw new Error(
      `K6 account is not ACTIVE: ${account.status}`,
    );
  }

  if (account.user.status !== "ACTIVE") {
    throw new Error(
      `K6 user is not ACTIVE: ${account.user.status}`,
    );
  }

  if (account.user.role !== "CUSTOMER") {
    throw new Error(
      `K6 user must be CUSTOMER: ${account.user.role}`,
    );
  }

  const accessToken = generateAccessToken({
    id: account.user.id,
    email: account.user.email,
    role: account.user.role,
    status: account.user.status,
  });

  console.log(
    "K6 access token generated successfully.",
  );

  console.log(accessToken);
};

main()
  .catch((error: unknown) => {
    console.error(
      "Failed to generate K6 token:",
      error,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });