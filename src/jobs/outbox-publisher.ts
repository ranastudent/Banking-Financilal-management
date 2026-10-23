import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { enqueueTransferJobs } from "./queues";
import type { TransferCommittedPayload } from "./types";

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
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM outbox_events
            WHERE id = ${candidate.id}::uuid AND status = 'PENDING'
            FOR UPDATE SKIP LOCKED
          `;
          if (locked.length === 0) return;

          const event = await tx.outboxEvent.findUnique({
            where: { id: candidate.id },
          });
          if (!event || event.status !== "PENDING") return;

          try {
            if (event.eventType !== "TRANSFER_COMMITTED") {
              throw new Error(`Unsupported outbox event type: ${event.eventType}`);
            }
            const payload = event.payload as unknown as {
              transactionId?: unknown;
              actorUserId?: unknown;
            };
            if (typeof payload.transactionId !== "string" || typeof payload.actorUserId !== "string") {
              throw new Error(`Invalid payload for outbox event ${event.id}`);
            }

            await enqueueTransferJobs({
              outboxEventId: event.id,
              transactionId: payload.transactionId,
              actorUserId: payload.actorUserId,
            } satisfies TransferCommittedPayload);

            await tx.outboxEvent.update({
              where: { id: event.id },
              data: { status: "PUBLISHED", publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Keep the event pending. If Redis accepted only some jobs, their
            // stable IDs make the next attempt idempotent.
            await tx.outboxEvent.update({
              where: { id: event.id },
              data: { attempts: { increment: 1 }, lastError: message.slice(0, 2000) },
            });
            console.error("[outbox] event publish failed", {
              eventId: event.id, eventType: event.eventType, error: message,
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
