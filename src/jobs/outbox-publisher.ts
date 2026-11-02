import { prisma } from "../config/prisma";
import { ingestMonitoringEvent } from "../monitoring/services/monitoring-event.service";
import { env } from "../config/env";
import { enqueueNotificationEvent, enqueueTransferJobs } from "./queues";
import type {
  NotificationEventPayload,
  NotificationType,
  TransferCommittedPayload,
} from "./types";

let timer: NodeJS.Timeout | null = null;
let publishing = false;

export const publishPendingOutboxEvents = async (): Promise<void> => {
  if (publishing) return;
  publishing = true;

  try {
    // Read a bounded candidate list, then lock each event inside its own
    // transaction. SKIP LOCKED lets multiple API replicas publish different
    // events without competing over the same event. Queue adds use stable job
    // IDs, so a partial Redis submission is safe to retry.
    const candidates = await prisma.outboxEvent.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: env.backgroundJobs.outboxBatchSize,
      select: { id: true },
    });

    for (const candidate of candidates) {
      try {
        await prisma.$transaction(async (tx) => {
          // Fetch the event data as part of the locking read. This avoids a
          // second round-trip (findUnique) after the row has been locked.
          // Keep the status predicate in SQL so a concurrently published event
          // cannot be processed again.
          const locked = await tx.$queryRaw<
            Array<{
              id: string;
              eventType: string;
              payload: unknown;
            }>
          >`
            SELECT
              id,
              event_type AS "eventType",
              payload
            FROM outbox_events
            WHERE id = ${candidate.id}::uuid
              AND status = 'PENDING'
            FOR UPDATE SKIP LOCKED
          `;

          const event = locked[0];
          if (!event) return;

          try {
            if (event.eventType === "TRANSFER_COMMITTED") {
              const payload = event.payload as unknown as {
                transactionId?: unknown;
                actorUserId?: unknown;
              };

              if (
                typeof payload.transactionId !== "string" ||
                typeof payload.actorUserId !== "string"
              ) {
                throw new Error(
                  `Invalid payload for outbox event ${event.id}`,
                );
              }

              await enqueueTransferJobs({
                outboxEventId: event.id,
                transactionId: payload.transactionId,
                actorUserId: payload.actorUserId,
              } satisfies TransferCommittedPayload);
            } else if (event.eventType === "MONITORING_EVENT_REQUESTED") {
              const payload = event.payload as unknown as {
                eventKey?: unknown; eventType?: unknown; transactionId?: unknown;
                accountId?: unknown; userId?: unknown; correlationId?: unknown;
                source?: unknown; occurredAt?: unknown; payload?: unknown;
              };
              if (
                typeof payload.eventKey !== "string" ||
                typeof payload.eventType !== "string" ||
                typeof payload.transactionId !== "string" ||
                typeof payload.accountId !== "string" ||
                typeof payload.userId !== "string" ||
                !payload.payload || typeof payload.payload !== "object" || Array.isArray(payload.payload)
              ) {
                throw new Error(`Invalid monitoring payload for outbox event ${event.id}`);
              }
              await ingestMonitoringEvent({
                eventKey: payload.eventKey,
                eventType: payload.eventType,
                transactionId: payload.transactionId,
                accountId: payload.accountId,
                userId: payload.userId,
                correlationId: event.id,
                source: typeof payload.source === "string" ? payload.source : "outbox",
                occurredAt: typeof payload.occurredAt === "string" ? payload.occurredAt : new Date(),
                payload: payload.payload as Record<string, unknown>,
              });
            } else if (event.eventType === "NOTIFICATION_REQUESTED") {
              const payload = event.payload as unknown as {
                userId?: unknown;
                notificationType?: unknown;
                title?: unknown;
                message?: unknown;
                metadata?: unknown;
              };

              const allowedTypes: NotificationType[] = [
                "TRANSFER_SUCCESS",
                "TRANSFER_FAILED",
                "DEPOSIT_SUCCESS",
                "WITHDRAWAL_SUCCESS",
                "ACCOUNT_BLOCKED",
                "SECURITY_ALERT",
              ];

              if (
                typeof payload.userId !== "string" ||
                typeof payload.notificationType !== "string" ||
                !allowedTypes.includes(
                  payload.notificationType as NotificationType,
                ) ||
                typeof payload.title !== "string" ||
                typeof payload.message !== "string" ||
                (payload.metadata !== undefined &&
                  (payload.metadata === null ||
                    typeof payload.metadata !== "object" ||
                    Array.isArray(payload.metadata)))
              ) {
                throw new Error(
                  `Invalid notification payload for outbox event ${event.id}`,
                );
              }

              // Omit metadata entirely when it is undefined.
              // This is compatible with exactOptionalPropertyTypes: true.
              const notificationPayload: NotificationEventPayload = {
                outboxEventId: event.id,
                userId: payload.userId,
                notificationType:
                  payload.notificationType as NotificationType,
                title: payload.title,
                message: payload.message,
                ...(payload.metadata !== undefined
                  ? {
                      metadata: payload.metadata as Record<
                        string,
                        string | number | boolean | null
                      >,
                    }
                  : {}),
              };

              await enqueueNotificationEvent(notificationPayload);
            } else {
              throw new Error(
                `Unsupported outbox event type: ${event.eventType}`,
              );
            }

            await tx.outboxEvent.update({
              where: { id: event.id },
              data: {
                status: "PUBLISHED",
                publishedAt: new Date(),
                attempts: { increment: 1 },
                lastError: null,
              },
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);

            // Keep the event pending. If Redis accepted only some jobs, their
            // stable IDs make the next attempt idempotent.
            await tx.outboxEvent.update({
              where: { id: event.id },
              data: {
                attempts: { increment: 1 },
                lastError: message.slice(0, 2000),
              },
            });

            console.error("[outbox] event publish failed", {
              eventId: event.id,
              eventType: event.eventType,
              error: message,
            });
          }
        });
      } catch (error) {
        console.error("[outbox] event processing transaction failed", {
          eventId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    console.error("[outbox] polling failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    publishing = false;
  }
};

export const startOutboxPublisher = (): void => {
  if (timer) return;

  void publishPendingOutboxEvents();

  timer = setInterval(() => {
    void publishPendingOutboxEvents();
  }, env.backgroundJobs.outboxPollIntervalMs);

  timer.unref();
};

export const stopOutboxPublisher = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // Wait for any current polling pass to finish before queue shutdown.
  while (publishing) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};