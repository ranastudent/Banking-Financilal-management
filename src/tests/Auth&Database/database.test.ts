import { describe, it, expect, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "../../config/env";

const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
});

describe("Database Connection", () => {
  it("should connect to PostgreSQL successfully", async () => {
    const result = await prisma.$queryRaw<{ result: number }[]>`
      SELECT 1 as result
    `;

    expect(result[0]?.result).toBe(1);
  });

  it("should have the required currencies seeded", async () => {
    const currencies = await prisma.currency.findMany({
      select: {
        code: true,
      },
      orderBy: {
        code: "asc",
      },
    });

    const currencyCodes = new Set(
      currencies.map((currency) => currency.code),
    );

    const requiredCurrencies = [
      "BDT",
      "EUR",
      "GBP",
      "JPY",
      "USD",
    ];

    for (const currencyCode of requiredCurrencies) {
      expect(currencyCodes.has(currencyCode)).toBe(true);
    }
  });

  it("should reject duplicate user emails", async () => {
    const testEmail = "database-test-user@example.test";

    await prisma.user.deleteMany({
      where: {
        email: testEmail,
      },
    });

    try {
      await prisma.user.create({
        data: {
          name: "Database Test User",
          email: testEmail,
          passwordHash: "test-password-hash",
        },
      });

      await expect(
        prisma.user.create({
          data: {
            name: "Duplicate Test User",
            email: testEmail,
            passwordHash: "test-password-hash",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.deleteMany({
        where: {
          email: testEmail,
        },
      });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});