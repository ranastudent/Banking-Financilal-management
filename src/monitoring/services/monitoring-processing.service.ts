import { prisma } from "../../config/prisma";
import { calculateBehaviorProfile } from "./behavioral-analytics.service";
import { detectTransactionAnomalies, persistAnomalies } from "./anomaly-detection.service";
import { runFraudModelInference } from "./ml-fraud.service";
import { createFraudAlert } from "./fraud-alert.service";
import { createDecisionExplanation } from "./decision-explanation.service";
const db = prisma as any;

export const processMonitoringEvent = async (eventId: string) => {
  const event = await db.monitoringEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new Error("Monitoring event not found");
  if (event.status === "PROCESSED" || event.status === "PROCESSING") return { duplicate: true };
  const attempt = event.attempts + 1;
  const claimed = await db.monitoringEvent.updateMany({
    where: { id: eventId, status: { in: ["PENDING", "FAILED", "DEAD_LETTER"] } },
    data: { status: "PROCESSING", attempts: attempt },
  });
  if (claimed.count !== 1) return { duplicate: true };
  const log = await db.monitoringProcessingLog.create({ data: { monitoringEventId: eventId, attempt, outcome: "STARTED" } });
  try {
    const tx = event.transactionId ? await db.transaction.findUnique({
      where: { id: event.transactionId },
      include: { sourceAccount: { select: { id: true, userId: true } } },
    }) : null;

    let profiles: any[] = [];
    if (event.accountId && tx?.currencyCode) profiles = await calculateBehaviorProfile(event.accountId, tx.currencyCode);

    const detections = await detectTransactionAnomalies(event);
    const anomalyRows = await persistAnomalies(event, detections);
    const features = profiles[0]?.featureSnapshot ?? {};
    let prediction: any = null;
    let modelInferenceError: string | null = null;
    try {
      prediction = await runFraudModelInference(event, features);
    } catch (modelError) {
      // Statistical monitoring must continue if the optional ML service is down.
      modelInferenceError = modelError instanceof Error ? modelError.message : String(modelError);
      console.error("[monitoring] ML inference unavailable; continuing without prediction", { eventId, error: modelInferenceError });
    }

    const alerts = [];
    for (const anomaly of anomalyRows) {
      if (anomaly.severity === "HIGH" || anomaly.severity === "CRITICAL") {
        alerts.push(await createFraudAlert({
          dedupeKey: `anomaly:${event.id}:${anomaly.detectionType}`,
          source: "STATISTICAL_ANOMALY",
          severity: anomaly.severity,
          title: "Unusual transaction activity detected",
          description: anomaly.explanation,
          monitoringEventId: event.id,
          transactionId: event.transactionId ?? undefined,
          accountId: event.accountId ?? undefined,
          userId: event.userId ?? undefined,
          riskScore: Math.round(Number(anomaly.score) * 10),
          evidence: { detectionType: anomaly.detectionType, algorithmVersion: anomaly.algorithmVersion },
        }));
      }
    }
    if (prediction && Number(prediction.fraudProbability) >= Number(process.env.FRAUD_ALERT_THRESHOLD ?? 0.85)) {
      alerts.push(await createFraudAlert({
        dedupeKey: `ml:${event.id}:${prediction.modelName}:${prediction.modelVersion}`,
        source: "ML_MODEL", severity: Number(prediction.fraudProbability) >= 0.97 ? "CRITICAL" : "HIGH",
        title: "Automated fraud model flagged activity",
        description: "Automated monitoring identified activity requiring analyst review.",
        monitoringEventId: event.id, transactionId: event.transactionId ?? undefined,
        accountId: event.accountId ?? undefined, userId: event.userId ?? undefined,
        riskScore: Math.round(Number(prediction.fraudProbability) * 100),
        evidence: { modelName: prediction.modelName, modelVersion: prediction.modelVersion },
      }));
    }
    for (const alert of alerts) {
      if (tx?.sourceAccount?.userId && tx.id) {
        await createDecisionExplanation({
          transactionId: tx.id, customerId: tx.sourceAccount.userId,
          phase: "PHASE33", source: "PHASE33_MONITORING",
          decision: tx.status === "COMPLETED" ? "APPROVED" : tx.status === "ON_HOLD" ? "ON_HOLD" : "PROCESSING",
          monitoringEventId: event.id, fraudAlertId: alert.id,
        });
      }
      if (event.userId) {
        await db.notification.upsert({
          where: { dedupeKey: `fraud-alert-${alert.id}-${event.userId}` },
          create: {
            userId: event.userId,
            type: "SECURITY_ALERT",
            title: "Security review notification",
            message: tx?.status === "COMPLETED"
              ? "Your transaction was completed. Subsequent monitoring identified activity requiring review. This notification does not mean the transaction was automatically stopped or reversed."
              : "We identified activity requiring a security review. Please check your transaction status in the official app.",
            channel: "IN_APP",
            status: "SENT",
            dedupeKey: `fraud-alert-${alert.id}-${event.userId}`,
            metadata: { transactionId: event.transactionId ?? null, monitoringEventId: event.id, fraudAlertId: alert.id },
          },
          update: {},
        });
      }
    }
    await db.monitoringEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null } });
    await db.monitoringProcessingLog.update({ where: { id: log.id }, data: { outcome: "SUCCEEDED", completedAt: new Date() } });
    return { eventId, profiles: profiles.length, anomalies: anomalyRows.length, alerts: alerts.length, modelPrediction: Boolean(prediction), modelInferenceError };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.monitoringEvent.update({ where: { id: eventId }, data: { status: attempt >= 5 ? "DEAD_LETTER" : "FAILED", lastError: message.slice(0, 2000) } });
    await db.monitoringProcessingLog.update({ where: { id: log.id }, data: { outcome: "FAILED", errorMessage: message.slice(0, 2000), completedAt: new Date() } });
    throw error;
  }
};
