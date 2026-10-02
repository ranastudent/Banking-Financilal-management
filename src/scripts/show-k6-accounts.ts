import { prisma } from "../config/prisma";

async function main() {
  const accounts = await prisma.account.findMany({
    where: {
      status: "ACTIVE",
      balances: {
        some: {
          currencyCode: "BDT",
          availableBalance: {
            gt: 0,
          },
        },
      },
    },
    select: {
      id: true,
      userId: true,
      accountNumber: true,
      status: true,
      balances: {
        where: {
          currencyCode: "BDT",
        },
        select: {
          currencyCode: true,
          availableBalance: true,
        },
      },
    },
    orderBy: {
      accountNumber: "asc",
    },
  });

  console.table(
    accounts.map((account) => ({
      id: account.id,
      userId: account.userId,
      accountNumber: account.accountNumber,
      status: account.status,
      currency: account.balances[0]?.currencyCode,
      balance: account.balances[0]?.availableBalance.toString(),
    })),
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});