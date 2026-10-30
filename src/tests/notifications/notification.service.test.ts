import "../setup";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    notification: {
      findMany: mocks.findMany,
      count: mocks.count,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  getUserNotifications,
  markUserNotificationAsRead,
} from "../../notifications/services/notification.service";

const notification = {
  id: "notification-1",
  userId: "user-1",
  type: "SECURITY_ALERT",
  title: "New sign-in",
  message: "A successful sign-in occurred.",
  channel: "IN_APP",
  status: "SENT",
  metadata: {},
  createdAt: new Date("2026-10-23T00:00:00.000Z"),
  readAt: null,
};

describe("notification service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([notification]);
    mocks.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    mocks.findFirst.mockResolvedValue(notification);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("returns only the requested user's notifications with pagination and unread count", async () => {
    const result = await getUserNotifications("user-1", { page: 2, limit: 10 });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: { in: ["SENT", "READ"] } },
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    }));
    expect(result).toEqual({
      notifications: [notification],
      unreadCount: 1,
      pagination: { page: 2, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it("supports unread-only filtering", async () => {
    await getUserNotifications("user-1", { page: 1, limit: 20, unreadOnly: true });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", status: "SENT" },
    }));
  });

  it("marks an owned SENT notification as READ", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce({ ...notification, status: "READ", readAt: new Date() });
    const result = await markUserNotificationAsRead("user-1", "notification-1");
    expect(mocks.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "notification-1", userId: "user-1" },
      select: expect.any(Object),
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "notification-1", userId: "user-1", status: "SENT" },
      data: { status: "READ", readAt: expect.any(Date) },
    }));
    expect(result.status).toBe("READ");
  });

  it("does not rewrite the timestamp for an already-read notification", async () => {
    const read = { ...notification, status: "READ", readAt: new Date() };
    mocks.findFirst.mockResolvedValueOnce(read);
    const result = await markUserNotificationAsRead("user-1", "notification-1");
    expect(result).toEqual(read);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not reveal another user's notification", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(markUserNotificationAsRead("user-1", "other-user-notification"))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
