import { prisma } from "../../config/prisma";
const db = prisma as any;

/**
 * Optional inference adapter. No model is bundled with this source archive.
 * The remote endpoint must be a separately validated/deployed model service.
 * Predictions are stored as advisory evidence and never authorize transactions.
 */
export const runFraudModelInference = async (event: any, featureSnapshot: Record<string, unknown>) => {
  const endpoint = process.env.FRAUD_MODEL_INFERENCE_URL;
  if (!endpoint) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.FRAUD_MODEL_TIMEOUT_MS ?? 2500));
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.FRAUD_MODEL_API_KEY ? { authorization: `Bearer ${process.env.FRAUD_MODEL_API_KEY}` } : {}) },
      body: JSON.stringify({ eventId: event.id, eventType: event.eventType, features: featureSnapshot }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Fraud inference service returned ${response.status}`);
    const output = await response.json() as Record<string, unknown>;
    const probability = Number(output.fraudProbability);
    const anomalyScore = Number(output.anomalyScore);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error("Model returned invalid fraudProbability");
    const registry = await db.fraudModelRegistry.findFirst({ where: { status: "DEPLOYED" }, orderBy: { deployedAt: "desc" } });
    if (!registry) return null;
    if (output.modelName !== undefined && output.modelName !== registry.name) throw new Error("Inference model name does not match the deployed model registry record");
    if (output.modelVersion !== undefined && output.modelVersion !== registry.version) throw new Error("Inference model version does not match the deployed model registry record");
    return db.fraudPrediction.create({
      data: {
        monitoringEventId: event.id,
        transactionId: event.transactionId,
        modelRegistryId: registry.id,
        modelName: registry.name,
        modelVersion: registry.version,
        featureSchemaVersion: String(output.featureSchemaVersion ?? "v1"),
        anomalyScore: Number.isFinite(anomalyScore) ? anomalyScore : null,
        fraudProbability: probability,
        prediction: output,
        explanation: output.explanation && typeof output.explanation === "object" ? output.explanation : undefined,
        latencyMs: Date.now() - started,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};
