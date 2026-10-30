/**
 * Shared integration-test reference data.
 *
 * This module is imported only by test files. It seeds the baseline currencies
 * before each test file's tests execute. Production modules do not import this
 * file, so production behavior and features remain unchanged.
 *
 * IMPORTANT: run the test suite only against a dedicated test database.
 */
import { beforeAll } from "vitest";
import { prisma } from "../config/prisma";

const requiredCurrencies = [
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", decimalPlaces: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimalPlaces: 0 },
  { code: "USD", name: "United States Dollar", symbol: "$", decimalPlaces: 2 },
] as const;

beforeAll(async () => {
  for (const currency of requiredCurrencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { isActive: true },
      create: { ...currency, isActive: true },
    });
  }
});
