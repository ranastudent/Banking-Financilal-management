import { prisma } from "../../config/prisma";
const db = prisma as any;

/** Rebuild rolling customer behaviour features from committed ledger-backed transactions. */
export const calculateBehaviorProfile = async (accountId: string, currencyCode: string, now = new Date()) => {
  const windows = [
    { code: "30D", days: 30 },
    { code: "90D", days: 90 },
  ];
  const results = [];
  for (const window of windows) {
    const start = new Date(now.getTime() - window.days * 86400000);
    const rows = await db.transaction.findMany({
      where: {
        sourceAccountId: accountId,
        currencyCode,
        status: "COMPLETED",
        createdAt: { gte: start, lte: now },
      },
      select: { id: true, amount: true, destinationAccountId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const amounts = rows.map((r: any) => Number(r.amount)).filter(Number.isFinite);
    const sum = amounts.reduce((a: number, b: number) => a + b, 0);
    const average = amounts.length ? sum / amounts.length : null;
    const hours = Array.from(new Set(rows.map((r: any) => new Date(r.createdAt).getUTCHours())));
    const distinctBeneficiaries = new Set(rows.map((r: any) => r.destinationAccountId).filter(Boolean)).size;
    const failedTransactionCount = await db.transaction.count({
      where: { sourceAccountId: accountId, currencyCode, status: "FAILED", createdAt: { gte: start, lte: now } },
    });
    const profile = await db.customerBehaviorProfile.upsert({
      where: { accountId_currencyCode_windowCode: { accountId, currencyCode, windowCode: window.code } },
      create: {
        accountId, currencyCode, windowCode: window.code,
        transactionCount: rows.length,
        failedTransactionCount,
        averageTransactionAmount: average,
        maximumTransactionAmount: amounts.length ? Math.max(...amounts) : null,
        dailyVolume: amounts.reduce((a: number, b: number) => a + b, 0) / window.days,
        weeklyVolume: sum / (window.days / 7),
        monthlyVolume: sum / (window.days / 30),
        distinctBeneficiaryCount: distinctBeneficiaries,
        activeHours: hours,
        featureSnapshot: { transactionCount: rows.length, averageAmount: average, maxAmount: amounts.length ? Math.max(...amounts) : null, beneficiaryCount: distinctBeneficiaries, activeHours: hours, failedTransactionCount },
        windowStart: start, windowEnd: now,
      },
      update: {
        transactionCount: rows.length,
        failedTransactionCount,
        averageTransactionAmount: average,
        maximumTransactionAmount: amounts.length ? Math.max(...amounts) : null,
        dailyVolume: sum / window.days,
        weeklyVolume: sum / (window.days / 7),
        monthlyVolume: sum / (window.days / 30),
        distinctBeneficiaryCount: distinctBeneficiaries,
        activeHours: hours,
        featureSnapshot: { transactionCount: rows.length, averageAmount: average, maxAmount: amounts.length ? Math.max(...amounts) : null, beneficiaryCount: distinctBeneficiaries, activeHours: hours, failedTransactionCount },
        windowStart: start, windowEnd: now, calculatedAt: now,
      },
    });
    results.push(profile);
  }
  return results;
};
