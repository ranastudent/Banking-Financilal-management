import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  sendEmail: vi.fn(),
  enqueueEmailRecipientJobs: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  riskUpsert: vi.fn(),
  reportUpsert: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    transaction: { findUnique: mocks.findUnique, groupBy: mocks.groupBy, count: mocks.count },
    riskAnalysis: { upsert: mocks.riskUpsert },
    backgroundReport: { upsert: mocks.reportUpsert },
  },
}));
vi.mock("../../utils/mailer", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../../jobs/queues", () => ({ enqueueEmailRecipientJobs: mocks.enqueueEmailRecipientJobs }));

import { handleGenerateReport, handleRiskAnalysis, handleSendEmail } from "../../jobs/handlers";
import { env } from "../../config/env";

const transfer = {
  id: "transaction-1",
  sourceAccountId: "source-account-1",
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
    mocks.count.mockResolvedValue(0);
    mocks.riskUpsert.mockResolvedValue({});
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

  it("stores LOW retrospective risk when the recent transfer count is below the configured threshold", async () => {
    const threshold = env.backgroundJobs.riskAnalysis.maxTransfersPerWindow;
    mocks.count.mockResolvedValue(Math.max(0, threshold - 1));

    await handleRiskAnalysis({
      outboxEventId: "event-risk-normal",
      transactionId: "transaction-1",
      actorUserId: "actor-1",
    });

    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceAccountId: "source-account-1",
        type: "INTERNAL_TRANSFER",
        status: "COMPLETED",
        createdAt: expect.objectContaining({ gte: expect.any(Date) }),
      }),
    }));
    expect(mocks.riskUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { transactionId: "transaction-1" },
      create: expect.objectContaining({
        transactionId: "transaction-1",
        riskLevel: "LOW",
        reasons: [],
      }),
      update: {},
    }));
  });

  it("records HIGH retrospective risk without attempting to hold an already committed transfer", async () => {
    const threshold = env.backgroundJobs.riskAnalysis.maxTransfersPerWindow;
    mocks.count.mockResolvedValue(threshold);

    await handleRiskAnalysis({
      outboxEventId: "event-risk-review",
      transactionId: "transaction-1",
      actorUserId: "actor-1",
    });

    expect(mocks.riskUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { transactionId: "transaction-1" },
      create: expect.objectContaining({
        transactionId: "transaction-1",
        riskLevel: "HIGH",
        reasons: expect.arrayContaining([
          expect.stringContaining(String(threshold)),
        ]),
      }),
      update: {},
    }));
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
