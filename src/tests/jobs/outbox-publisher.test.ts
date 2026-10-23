import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enqueueTransferJobs: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    outboxEvent: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../../jobs/queues", () => ({
  enqueueTransferJobs: mocks.enqueueTransferJobs,
}));

import { publishPendingOutboxEvents } from "../../jobs/outbox-publisher";

const event = {
  id: "5d0e0b8b-4b2e-4ed7-9d52-2cb9c3a9b021",
  eventType: "TRANSFER_COMMITTED",
  payload: { transactionId: "transaction-1", actorUserId: "user-1" },
  status: "PENDING",
};

describe("outbox publisher reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ id: event.id }]);
    mocks.queryRaw.mockResolvedValue([{ id: event.id }]);
    mocks.findUnique.mockResolvedValue(event);
    mocks.update.mockResolvedValue({ ...event, status: "PUBLISHED" });
    mocks.enqueueTransferJobs.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback: any) =>
      callback({
        $queryRaw: mocks.queryRaw,
        outboxEvent: { findUnique: mocks.findUnique, update: mocks.update },
      }),
    );
  });

  it("publishes and marks the outbox event only after all jobs enqueue", async () => {
    await publishPendingOutboxEvents();
    expect(mocks.enqueueTransferJobs).toHaveBeenCalledWith({
      outboxEventId: event.id,
      transactionId: "transaction-1",
      actorUserId: "user-1",
    });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: event.id },
      data: expect.objectContaining({ status: "PUBLISHED", lastError: null }),
    }));
  });

  it("records a partial queue submission failure and leaves the event pending for retry", async () => {
    mocks.enqueueTransferJobs.mockRejectedValueOnce(new Error("Redis unavailable after first job"));
    await publishPendingOutboxEvents();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: event.id },
      data: expect.objectContaining({
        attempts: { increment: 1 },
        lastError: "Redis unavailable after first job",
      }),
    }));
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PUBLISHED" }),
    }));
  });

  it("skips an event locked by another publisher replica", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await publishPendingOutboxEvents();
    expect(mocks.enqueueTransferJobs).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
