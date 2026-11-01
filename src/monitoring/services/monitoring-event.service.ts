import { prisma } from "../../config/prisma";
import { enqueueMonitoringEvent } from "../../jobs/queues";
import type { MonitoringEventInput } from "../types/monitoring.types";
import { isPlainObject } from "../types/monitoring.types";

const db = prisma as any;

export const ingestMonitoringEvent = async (input: MonitoringEventInput) => {
  if (!input.eventKey?.trim() || !input.eventType?.trim() || !isPlainObject(input.payload)) {
    throw new Error("eventKey, eventType and an object payload are required");
  }
  const existing = await db.monitoringEvent.findUnique({ where: { eventKey: input.eventKey } });
  const event = await db.monitoringEvent.upsert({
    where: { eventKey: input.eventKey },
    create: {
      eventKey: input.eventKey,
      eventType: input.eventType,
      schemaVersion: 1,
      transactionId: input.transactionId,
      accountId: input.accountId,
      userId: input.userId,
      correlationId: input.correlationId,
      source: input.source ?? "application",
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      payload: input.payload,
    },
    update: {},
  });
  if (event.status === "PENDING" || event.status === "FAILED") {
    await enqueueMonitoringEvent({ monitoringEventId: event.id });
  }
  return { event, duplicate: Boolean(existing) };
};

export const ingestCommittedTransaction = async (transactionId: string, outboxEventId: string) => {
  const transaction = await db.transaction.findUnique({
    where: { id: transactionId },
    include: { sourceAccount: { select: { id: true, userId: true } } },
  });
  if (!transaction) throw new Error(`Transaction ${transactionId} not found`);
  return ingestMonitoringEvent({
    eventKey: `transaction-committed:${outboxEventId}`,
    eventType: "TRANSACTION_COMMITTED",
    transactionId: transaction.id,
    accountId: transaction.sourceAccountId ?? undefined,
    userId: transaction.sourceAccount?.userId,
    correlationId: outboxEventId,
    source: "transaction-outbox",
    occurredAt: transaction.createdAt,
    payload: {
      reference: transaction.reference,
      amount: transaction.amount.toString(),
      currencyCode: transaction.currencyCode,
      status: transaction.status,
      type: transaction.type,
    },
  });
};
