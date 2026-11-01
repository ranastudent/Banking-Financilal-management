import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
const db = prisma as any;

export const createFraudModelDraft = async (input: {
  name: string; version: string; featureSchemaVersion: string;
  trainingDatasetVersion?: string; artifactChecksum?: string;
  evaluationMetrics?: Record<string, unknown>; metadata?: Record<string, unknown>;
}, actorId: string) => {
  if (!input.name.trim() || !input.version.trim() || !input.featureSchemaVersion.trim()) throw new Error("Model name, version and feature schema version are required");
  if (input.artifactChecksum && !/^[a-f0-9]{64}$/i.test(input.artifactChecksum)) throw new Error("Artifact checksum must be a SHA-256 hex digest");
  return db.$transaction(async (tx: any) => {
    const model = await tx.fraudModelRegistry.create({ data: input });
    await writeAuditLog({ userId: actorId, action: "FRAUD_MODEL_DRAFT_CREATED", resource: "FRAUD_MODEL", resourceId: model.id, description: `Fraud model draft ${model.name}:${model.version} created.` }, tx);
    return model;
  });
};

export const transitionFraudModel = async (modelId: string, action: "VALIDATE" | "APPROVE" | "DEPLOY" | "DISABLE" | "RETIRE", actorId: string) =>
  db.$transaction(async (tx: any) => {
    const model = await tx.fraudModelRegistry.findUnique({ where: { id: modelId } });
    if (!model) throw new Error("Fraud model not found");
    let status: string;
    const now = new Date();
    if (action === "VALIDATE" && model.status === "DRAFT") status = "VALIDATING";
    else if (action === "APPROVE" && model.status === "VALIDATING" && model.evaluationMetrics && model.artifactChecksum) status = "APPROVED";
    else if (action === "DEPLOY" && model.status === "APPROVED") status = "DEPLOYED";
    else if (action === "DISABLE" && model.status === "DEPLOYED") status = "DISABLED";
    else if (action === "RETIRE" && ["APPROVED", "DISABLED", "DEPLOYED"].includes(model.status)) status = "RETIRED";
    else throw new Error(`Model cannot transition from ${model.status} using ${action}`);

    if (action === "DEPLOY") {
      await tx.fraudModelRegistry.updateMany({ where: { status: "DEPLOYED", id: { not: modelId } }, data: { status: "DISABLED" } });
    }
    const updated = await tx.fraudModelRegistry.update({
      where: { id: modelId },
      data: { status, ...(action === "APPROVE" ? { approvedAt: now } : {}), ...(action === "DEPLOY" ? { deployedAt: now } : {}), ...(action === "RETIRE" ? { retiredAt: now } : {}) },
    });
    await writeAuditLog({ userId: actorId, action: `FRAUD_MODEL_${action}`, resource: "FRAUD_MODEL", resourceId: modelId, description: `Fraud model ${model.name}:${model.version} transitioned to ${status}.`, metadata: { fromStatus: model.status, toStatus: status } }, tx);
    return updated;
  });

export const listFraudModels = async () => db.fraudModelRegistry.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
