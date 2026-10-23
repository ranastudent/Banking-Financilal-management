import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sendEmail: vi.fn(),
  enqueueEmailRecipientJobs: vi.fn(),
  groupBy: vi.fn(),
  reportUpsert: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    transaction: { findUnique: mocks.findUnique, groupBy: mocks.groupBy },
    backgroundReport: { upsert: mocks.reportUpsert },
  },
}));
vi.mock("../../utils/mailer", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../../jobs/queues", () => ({ enqueueEmailRecipientJobs: mocks.enqueueEmailRecipientJobs }));

import { handleGenerateReport, handleSendEmail } from "../../jobs/handlers";

const transfer = {
  id: "transaction-1",
  amount: "100.00",
  reference: "TRF-TEST-1",
  currencyCode: "BDT",
  sourceAccount: { userId: "sender-id", user: { id: "sender-id", email: "sender@example.test", name: "Sender" } },
  destinationAccount: { userId: "receiver-id", user: { id: "receiver-id", email: "receiver@example.test", name: "Receiver" } },
};

describe("background job handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(transfer);
    mocks.sendEmail.mockResolvedValue(undefined);
    mocks.enqueueEmailRecipientJobs.mockResolvedValue(undefined);
    mocks.groupBy.mockResolvedValue([]);
    mocks.reportUpsert.mockResolvedValue({});
  });

  it("fans email delivery out into independently retryable recipient jobs", async () => {
    await handleSendEmail({ outboxEventId: "event-1", transactionId: "transaction-1", actorUserId: "actor-1" });
    expect(mocks.enqueueEmailRecipientJobs).toHaveBeenCalledWith(
      { outboxEventId: "event-1", transactionId: "transaction-1", actorUserId: "actor-1" },
      ["sender-id", "receiver-id"],
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends only the selected recipient and propagates mailer failures for retry", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("SMTP temporarily unavailable"));
    await expect(handleSendEmail({
      outboxEventId: "event-1", transactionId: "transaction-1", actorUserId: "actor-1", recipientUserId: "sender-id",
    })).rejects.toThrow("SMTP temporarily unavailable");
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0]?.[0]?.to).toBe("sender@example.test");
  });

  it("uses the scheduled occurrence timestamp to determine the report period", async () => {
    const scheduledAt = Date.parse("2026-10-23T01:00:00.000Z");
    await handleGenerateReport({ trigger: "scheduled" }, scheduledAt);
    expect(mocks.reportUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        periodStart: new Date("2026-10-22T00:00:00.000Z"),
        periodEnd: new Date("2026-10-23T00:00:00.000Z"),
      }),
    }));
  });
});
