import { z } from "zod";

export const fraudModelIdParamsSchema = z.object({ modelId: z.string().uuid("Invalid fraud model ID") }).strict();

export const createFraudModelSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    version: z.string().trim().min(1).max(50),
    featureSchemaVersion: z.string().trim().min(1).max(50),
    trainingDatasetVersion: z.string().trim().max(100).optional(),
    artifactChecksum: z.string().regex(/^[a-f0-9]{64}$/i, "Artifact checksum must be a SHA-256 hex digest").optional(),
    evaluationMetrics: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const transitionFraudModelSchema = z
  .object({
    action: z.enum(["VALIDATE", "APPROVE", "DEPLOY", "DISABLE", "RETIRE"]),
  })
  .strict();
