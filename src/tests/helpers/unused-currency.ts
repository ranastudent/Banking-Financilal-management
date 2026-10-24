import { randomInt } from "node:crypto";
import { prisma } from "../../config/prisma";

/** Return a three-letter currency code that is currently absent from the test DB.
 * This avoids assuming a reserved code (for example ZZZ) is globally unused.
 */
export const findUnusedCurrencyCode = async (): Promise<string> => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Random candidates avoid scanning the full code space in a shared test DB.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = Array.from({ length: 3 }, () => letters.charAt(randomInt(letters.length))).join("");
    const existing = await prisma.currency.findUnique({ where: { code }, select: { code: true } });
    if (!existing) return code;
  }

  // Deterministic fallback makes failure explicit if the currency namespace is exhausted.
  for (let a = 0; a < letters.length; a += 1) {
    for (let b = 0; b < letters.length; b += 1) {
      for (let c = 0; c < letters.length; c += 1) {
        const code = `${letters.charAt(a)}${letters.charAt(b)}${letters.charAt(c)}`;
        const existing = await prisma.currency.findUnique({ where: { code }, select: { code: true } });
        if (!existing) return code;
      }
    }
  }

  throw new Error("No unused three-letter currency code is available for this test");
};
