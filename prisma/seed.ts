import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // ==========================================
  // 1. Seed currencies
  // ==========================================

  const currencies = [
    {
      code: "BDT",
      name: "Bangladeshi Taka",
      symbol: "৳",
      decimalPlaces: 2,
    },
    {
      code: "USD",
      name: "United States Dollar",
      symbol: "$",
      decimalPlaces: 2,
    },
    {
      code: "EUR",
      name: "Euro",
      symbol: "€",
      decimalPlaces: 2,
    },
    {
      code: "GBP",
      name: "British Pound",
      symbol: "£",
      decimalPlaces: 2,
    },
    {
      code: "JPY",
      name: "Japanese Yen",
      symbol: "¥",
      decimalPlaces: 0,
    },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: {
        code: currency.code,
      },
      update: {
        name: currency.name,
        symbol: currency.symbol,
        decimalPlaces: currency.decimalPlaces,
        isActive: true,
      },
      create: {
        code: currency.code,
        name: currency.name,
        symbol: currency.symbol,
        decimalPlaces: currency.decimalPlaces,
        isActive: true,
      },
    });
  }

  console.log("✅ Currencies seeded successfully");



  // ==========================================
  // 3. Hash admin password
  // ==========================================

  const passwordHash = await bcrypt.hash(env.defaultAdminPassword, 12);

  // ==========================================
  // 4. Create/update default ADMIN
  // ==========================================

  const admin = await prisma.user.upsert({
    where: {
      email: env.defaultAdminEmail,
    },
    update: {
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      passwordHash,
    },
    create: {
      name: "System Administrator",
      email: env.defaultAdminEmail,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  console.log("✅ Default admin ready");

  console.log("🌱 Database seed completed successfully!");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });