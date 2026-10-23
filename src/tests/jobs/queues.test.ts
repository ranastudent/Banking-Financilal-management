import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn(), quit: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: class {
    add = mocks.add;
    close = mocks.close;
    constructor() { /* mocked queue */ }
  },
}));
vi.mock("../../jobs/connection", () => ({
  createBullMqQueueConnection: () => ({ status: "ready", quit: mocks.quit }),
}));

import {
  enqueueEmailRecipientJobs,
  enqueueNotificationEvent,
  enqueueReportGeneration,
  enqueueTransferJobs,
} from "../../jobs/queues";

describe("background queue idempotency", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.add.mockResolvedValue({ id: "mock-job" }); });

  it("uses stable IDs for transfer jobs so a partial outbox retry is deduplicated by BullMQ", async () => {
    const payload = { outboxEventId: "event-1", transactionId: "tx-1", actorUserId: "user-1" };
    await enqueueTransferJobs(payload);
    await enqueueTransferJobs(payload);
    const ids = mocks.add.mock.calls.map((call) => call[2]?.jobId);
    expect(ids).toEqual([
      "event-1-send-email", "event-1-send-notification", "event-1-process-audit-event", "event-1-risk-analysis",
      "event-1-send-email", "event-1-send-notification", "event-1-process-audit-event", "event-1-risk-analysis",
    ]);
  });

  it("creates one stable email job per unique recipient", async () => {
    const payload = { outboxEventId: "event-2", transactionId: "tx-2", actorUserId: "user-2" };
    await enqueueEmailRecipientJobs(payload, ["user-a", "user-b", "user-a"]);
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add.mock.calls.map((call) => call[2]?.jobId)).toEqual([
      "event-2-send-email-user-a", "event-2-send-email-user-b",
    ]);
  });

  it("does not collide report jobs with different period boundaries", async () => {
    await enqueueReportGeneration({ trigger: "manual", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-02T00:00:00.000Z" });
    await enqueueReportGeneration({ trigger: "manual", periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-10-03T00:00:00.000Z" });
    expect(mocks.add.mock.calls[0]?.[2]?.jobId).not.toBe(mocks.add.mock.calls[1]?.[2]?.jobId);
  });
});

describe("notification queue idempotency", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.add.mockResolvedValue({ id: "mock-job" }); });

  it("uses a stable per-user job ID for notification events", async () => {
    const payload = {
      outboxEventId: "event-24",
      userId: "user-24",
      notificationType: "SECURITY_ALERT" as const,
      title: "New sign-in",
      message: "A new sign-in occurred.",
      metadata: { event: "SUCCESSFUL_LOGIN" },
    };
    await enqueueNotificationEvent(payload);
    await enqueueNotificationEvent(payload);
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add.mock.calls[0]?.[0]).toBe("send-notification-event");
    expect(mocks.add.mock.calls.map((call) => call[2]?.jobId)).toEqual([
      "event-24-notification-user-24",
      "event-24-notification-user-24",
    ]);
  });
});
