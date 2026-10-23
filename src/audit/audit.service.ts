import type { Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";
import type { AuditEventInput } from "./audit.types";

type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

const SENSITIVE_METADATA_KEY =
  /(password|passwd|otp|token(?!revoked)|authorization|secret|api.?key|credential|cvv|cvc|pin|card.?number)/i;

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      sanitized[key] = SENSITIVE_METADATA_KEY.test(key)
        ? "[REDACTED]"
        : sanitizeValue(nestedValue);
    }

    return sanitized;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  return String(value);
};

const sanitizeMetadata = (
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined => {
  if (metadata === undefined) {
    return undefined;
  }

  return sanitizeValue(metadata) as Prisma.InputJsonObject;
};

/**
 * Writes one structured audit event.
 *
 * Pass a Prisma transaction client for sensitive business operations so the
 * audit record commits or rolls back with the business data. This module
 * intentionally exposes no update/delete operation for audit records.
 */
export const writeAuditLog = async (
  event: AuditEventInput,
  client: AuditClient = prisma,
) => {
  const metadata = sanitizeMetadata(event.metadata);

  return client.auditLog.create({
    data: {
      userId: event.userId ?? null,
      action: event.action,
      entityType: event.resource,
      entityId: event.resourceId ?? null,
      description: event.description ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
      success: event.success ?? true,
      failureReason: event.failureReason ?? null,
      ...(metadata !== undefined ? { metadata } : {}),
    },
  });
};

/**
 * Security-event fallback for cases such as failed login attempts.
 * A logging outage must not turn an invalid login into a successful login
 * or reveal whether an account exists.
 */
export const writeSecurityAuditLogSafely = async (
  event: AuditEventInput,
): Promise<void> => {
  try {
    await writeAuditLog(event);
  } catch (error) {
    console.error("[audit] unable to persist security audit event", {
      action: event.action,
      requestId: event.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
