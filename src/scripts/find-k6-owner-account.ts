import { prisma } from "../config/prisma";

async function main() {
  const accounts = await prisma.account.findMany({
    where: {
      userId: "8d4128cb-4cd1-4bbf-b1ba-c9679a55618b",
      status: "ACTIVE",
    },
    select: {
      id: true,
      accountNumber: true,
      status: true,
    },
    orderBy: {
      accountNumber: "asc",
    },
  });

  console.table(accounts);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});