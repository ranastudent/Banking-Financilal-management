import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

type TransactionGroup = {
  type: string;
  status: string;
  currencyCode: string;
  _count: { _all: number };
  _sum: { amount: Prisma.Decimal | null };
};

type CurrencyTotal = {
  currencyCode: string;
  count: number;
  amount: string;
};

const DEPOSIT_TYPES = new Set(["DEPOSIT", "EXTERNAL_DEPOSIT"]);
const WITHDRAWAL_TYPES = new Set(["WITHDRAWAL"]);
const TRANSFER_TYPES = new Set(["INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"]);

const sumByCurrency = (
  rows: TransactionGroup[],
  types: Set<string>,
): CurrencyTotal[] => {
  const totals = new Map<string, { count: number; amount: Prisma.Decimal }>();

  for (const row of rows) {
    if (row.status !== "COMPLETED" || !types.has(row.type)) continue;

    const current = totals.get(row.currencyCode) ?? {
      count: 0,
      amount: new Prisma.Decimal(0),
    };

    current.count += row._count._all;
    current.amount = current.amount.plus(row._sum.amount ?? 0);
    totals.set(row.currencyCode, current);
  }

  return [...totals.entries()]
    .sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB))
    .map(([currencyCode, total]) => ({
      currencyCode,
      count: total.count,
      // Keep monetary values as strings to avoid JavaScript floating-point loss.
      amount: total.amount.toFixed(),
    }));
};

const countTransactions = (
  rows: TransactionGroup[],
  predicate: (row: TransactionGroup) => boolean,
): number => rows.reduce(
  (total, row) => total + (predicate(row) ? row._count._all : 0),
  0,
);

/**
 * Read-only administrative dashboard metrics.
 * Monetary totals are grouped by currency; currencies are never added together.
 */
export const getAdminDashboard = async () => {
  const [totalUsers, totalAccounts, blockedUsers, frozenAccounts, transactionGroups] =
    await Promise.all([
      prisma.user.count(),
      prisma.account.count(),
      prisma.user.count({ where: { status: "BLOCKED" } }),
      prisma.account.count({ where: { status: "FROZEN" } }),
      prisma.transaction.groupBy({
        by: ["type", "status", "currencyCode"],
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

  const rows = transactionGroups as TransactionGroup[];
  const depositsByCurrency = sumByCurrency(rows, DEPOSIT_TYPES);
  const withdrawalsByCurrency = sumByCurrency(rows, WITHDRAWAL_TYPES);
  const transfersByCurrency = sumByCurrency(rows, TRANSFER_TYPES);

  return {
    totalUsers,
    totalAccounts,
    totalDeposits: {
      count: depositsByCurrency.reduce((total, item) => total + item.count, 0),
      amountByCurrency: depositsByCurrency.map(({ currencyCode, amount }) => ({ currencyCode, amount })),
    },
    totalWithdrawals: {
      count: withdrawalsByCurrency.reduce((total, item) => total + item.count, 0),
      amountByCurrency: withdrawalsByCurrency.map(({ currencyCode, amount }) => ({ currencyCode, amount })),
    },
    totalTransfers: {
      count: transfersByCurrency.reduce((total, item) => total + item.count, 0),
      amountByCurrency: transfersByCurrency.map(({ currencyCode, amount }) => ({ currencyCode, amount })),
    },
    failedTransactions: countTransactions(rows, (row) => row.status === "FAILED"),
    // Includes PENDING and PROCESSING so the dashboard shows all in-flight work.
    pendingTransactions: countTransactions(
      rows,
      (row) => row.status === "PENDING" || row.status === "PROCESSING",
    ),
    // AccountStatus has FROZEN, not BLOCKED. Keep both concepts visible separately.
    blockedAccounts: frozenAccounts,
    blockedUsers,
    frozenAccounts,
  };
};
