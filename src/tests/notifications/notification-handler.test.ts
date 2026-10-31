import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("../../config/prisma", () => ({
  prisma: { notification: { upsert: mocks.upsert } },
}));
vi.mock("../../jobs/queues", () => ({
  enqueueEmailRecipientJobs: vi.fn(),
}));
vi.mock("../../utils/mailer", () => ({ sendEmail: vi.fn() }));

import { handleSendNotificationEvent } from "../../jobs/handlers";

describe("notification event handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({});
  });

  it("creates an in-app notification with event-scoped deduplication", async () => {
    await handleSendNotificationEvent({
      outboxEventId: "outbox-1",
      userId: "user-1",
      notificationType: "ACCOUNT_BLOCKED",
      title: "Account blocked",
      message: "Contact support.",
      metadata: { previousStatus: "ACTIVE", newStatus: "BLOCKED" },
    });

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: "outbox-1-user-1" },
      create: expect.objectContaining({
        userId: "user-1",
        type: "ACCOUNT_BLOCKED",
        channel: "IN_APP",
        status: "SENT",
        dedupeKey: "outbox-1-user-1",
        metadata: expect.objectContaining({
          outboxEventId: "outbox-1",
          notificationType: "ACCOUNT_BLOCKED",
        }),
      }),
      update: {},
    });
  });

  it("rejects malformed notification event payloads", async () => {
    await expect(handleSendNotificationEvent({
      outboxEventId: "",
      userId: "",
      notificationType: "SECURITY_ALERT",
      title: "Alert",
      message: "Alert",
    })).rejects.toThrow("missing its user or outbox event ID");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
