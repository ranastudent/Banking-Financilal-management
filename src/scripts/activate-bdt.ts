import { prisma } from "../config/prisma";

async function main() {
  await prisma.currency.update({
    where: {
      code: "BDT",
    },
    data: {
      isActive: true,
    },
  });

  console.log("BDT currency activated successfully.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });