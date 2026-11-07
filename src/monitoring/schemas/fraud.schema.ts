import { z } from "zod";

const uuidSchema = z.string().uuid("Invalid identifier");

export const fraudAlertParamsSchema = z.object({ alertId: uuidSchema }).strict();
export const fraudCaseParamsSchema = z.object({ caseId: uuidSchema }).strict();

export const updateFraudAlertSchema = z
  .object({
    status: z.enum(["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "ESCALATED", "FALSE_POSITIVE"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

export const updateFraudCaseSchema = z
  .object({
    status: z.enum(["ACKNOWLEDGED", "INVESTIGATING", "PENDING_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"]),
    comment: z.string().trim().max(2000).optional(),
    resolution: z.string().trim().max(5000).optional(),
  })
  .strict();

export const addFraudCaseNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(5000),
    isInternal: z.boolean().optional(),
  })
  .strict();

export const assignFraudCaseSchema = z
  .object({
    assignedToId: uuidSchema,
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();

export const addFraudCaseEvidenceSchema = z
  .object({
    evidenceType: z.enum(["DOCUMENT", "IMAGE", "TRANSACTION_REFERENCE", "SYSTEM_LOG", "EXTERNAL_REFERENCE", "OTHER"]),
    storageRef: z.string().trim().min(1).max(500).refine((value) => !value.includes(".."), "Invalid storage reference"),
    fileName: z.string().trim().max(255).optional(),
    mimeType: z.string().trim().max(100).optional(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/i, "Checksum must be a SHA-256 hex digest").optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
