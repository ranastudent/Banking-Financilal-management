import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../config/prisma";

describe("Database Connection", () => {
  it("should connect to PostgreSQL successfully", async () => {
    await expect(prisma.$connect()).resolves.not.toThrow();
  });

  it("should execute a simple database query", async () => {
    const result = await prisma.$queryRaw<{ result: number }[]>`SELECT 1 AS result`;

    expect(result).toHaveLength(1);
    const firstRow = result.at(0);
    expect(firstRow).toBeDefined();
    expect(firstRow?.result).toBe(1);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});