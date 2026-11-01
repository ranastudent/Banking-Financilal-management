import { prisma } from "../../config/prisma";
const db = prisma as any;

/** Aggregated operational dashboard; never returns customer-facing model internals. */
export const getFraudIntelligenceDashboard = async (from?: Date, to = new Date()) => {
  const start = from ?? new Date(to.getTime() - 30 * 86400000);
  const [alertsByStatus, alertsBySeverity, casesByStatus, recentAlerts, eventHealth, predictions] = await Promise.all([
    db.fraudAlert.groupBy({ by: ["status"], where: { createdAt: { gte: start, lte: to } }, _count: { _all: true } }),
    db.fraudAlert.groupBy({ by: ["severity"], where: { createdAt: { gte: start, lte: to } }, _count: { _all: true } }),
    db.fraudCase.groupBy({ by: ["status"], where: { createdAt: { gte: start, lte: to } }, _count: { _all: true } }),
    db.fraudAlert.findMany({ where: { createdAt: { gte: start, lte: to } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, severity: true, status: true, source: true, createdAt: true, transactionId: true } }),
    db.monitoringEvent.groupBy({ by: ["status"], where: { createdAt: { gte: start, lte: to } }, _count: { _all: true } }),
    db.fraudPrediction.count({ where: { predictedAt: { gte: start, lte: to } } }),
  ]);
  return { period: { from: start, to }, alertsByStatus, alertsBySeverity, casesByStatus, recentAlerts, eventHealth, modelPredictionCount: predictions };
};
