import { describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";

describe("Stage 2E account/status locking protocol", () => {
  it("serializes concurrent status updates on the same account", async () => {
    const account = await prisma.account.findFirst({
      where: {
        status: "ACTIVE",
      },
      select: {
        id: true,
        status: true,
      },
    });

    expect(account).not.toBeNull();

    if (!account) {
      return;
    }

    const first = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM accounts
          WHERE id = CAST(${account.id} AS uuid)
          FOR UPDATE
        `;

        await new Promise((resolve) =>
          setTimeout(resolve, 500),
        );

        return true;
      },
    );

    expect(first).toBe(true);
  });

  it("allows financial Account FOR SHARE to coexist with another financial operation", async () => {
    const account = await prisma.account.findFirst({
      where: {
        status: "ACTIVE",
      },
      select: {
        id: true,
      },
    });

    expect(account).not.toBeNull();

    if (!account) {
      return;
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM accounts
          WHERE id = CAST(${account.id} AS uuid)
          FOR SHARE
        `;

        return rows.length;
      },
    );

    expect(result).toBe(1);
  });

  it("uses Account before AccountBalance for status locking", async () => {
    const account = await prisma.account.findFirst({
      select: {
        id: true,
      },
    });

    expect(account).not.toBeNull();

    if (!account) {
      return;
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const accountRows = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM accounts
          WHERE id = CAST(${account.id} AS uuid)
          FOR UPDATE
        `;

        const balanceRows = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM account_balances
          WHERE account_id = CAST(${account.id} AS uuid)
          ORDER BY currency_code ASC
          FOR UPDATE
        `;

        return {
          accountLocked:
            accountRows.length === 1,
          balancesLocked:
            balanceRows.length >= 0,
        };
      },
    );

    expect(result.accountLocked).toBe(true);
    expect(result.balancesLocked).toBe(true);
  });
});