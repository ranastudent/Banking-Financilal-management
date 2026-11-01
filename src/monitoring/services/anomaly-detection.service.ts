import { prisma } from "../../config/prisma";
import type { DetectionResult } from "../types/monitoring.types";
const db = prisma as any;

const severityFor = (score: number): DetectionResult["severity"] =>
  score >= 5 ? "CRITICAL" : score >= 3.5 ? "HIGH" : score >= 2.5 ? "MEDIUM" : "LOW";

/** Robust-ish z-score with a minimum history requirement; advisory only. */
export const detectTransactionAnomalies = async (event: any): Promise<DetectionResult[]> => {
  if (!event.transactionId || !event.accountId) return [];
  const tx = await db.transaction.findUnique({ where: { id: event.transactionId }, select: { amount: true, currencyCode: true, createdAt: true, status: true } });
  if (!tx || tx.status !== "COMPLETED") return [];
  const history = await db.transaction.findMany({
    where: { sourceAccountId: event.accountId, currencyCode: tx.currencyCode, status: "COMPLETED", createdAt: { lt: tx.createdAt } },
    orderBy: { createdAt: "desc" }, take: 100, select: { amount: true },
  });
  if (history.length < 10) return [];
  const values = history.map((x: any) => Number(x.amount)).filter(Number.isFinite);
  const mean = values.reduce((a: number,b: number)=>a+b,0)/values.length;
  const variance = values.reduce((a: number,b: number)=>a+(b-mean)**2,0)/values.length;
  const std = Math.sqrt(variance);
  const observed = Number(tx.amount);
  if (!Number.isFinite(observed) || std <= 0) return [];
  const z = Math.abs((observed-mean)/std);
  if (z < 2) return [];
  return [{
    detectionType: "TRANSFER_AMOUNT_ZSCORE",
    score: Math.min(10, z),
    severity: severityFor(z),
    observedValue: observed,
    expectedValue: mean,
    explanation: "Transaction amount is unusually far from the account's recent completed-transfer baseline.",
    evidence: { baselineCount: values.length, standardDeviation: std, algorithm: "absolute-z-score" },
    algorithmVersion: "statistical-v1",
  }];
};

export const persistAnomalies = async (event: any, detections: DetectionResult[]) => {
  const created = [];
  for (const detection of detections) {
    const result = await db.anomalyDetectionResult.create({
      data: {
        monitoringEventId: event.id,
        transactionId: event.transactionId,
        accountId: event.accountId,
        detectionType: detection.detectionType,
        score: detection.score,
        severity: detection.severity,
        observedValue: detection.observedValue,
        expectedValue: detection.expectedValue,
        explanation: detection.explanation,
        evidence: detection.evidence ?? {},
        algorithmVersion: detection.algorithmVersion,
      },
    });
    created.push(result);
  }
  return created;
};
