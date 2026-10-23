import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  getUserNotifications: vi.fn(),
  markUserNotificationAsRead: vi.fn(),
}));

vi.mock("../../notifications/services/notification.service", () => mocks);
import {
  getNotifications,
  markNotificationAsRead,
} from "../../notifications/controllers/notification.controller";

const response = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe("notification controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserNotifications.mockResolvedValue({ notifications: [], unreadCount: 0, pagination: {} });
    mocks.markUserNotificationAsRead.mockResolvedValue({ id: "notification-1", status: "READ" });
  });

  it("lists notifications for the authenticated user", async () => {
    const req = {
      user: { id: "user-1", email: "user@example.test", role: "CUSTOMER", status: "ACTIVE" },
      query: { page: "2", limit: "10", unreadOnly: "true" },
      requestId: "request-1",
    } as unknown as Request;
    const res = response();
    await getNotifications(req, res as unknown as Response);

    expect(mocks.getUserNotifications).toHaveBeenCalledWith("user-1", {
      page: 2, limit: 10, unreadOnly: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("rejects invalid pagination input", async () => {
    const req = {
      user: { id: "user-1", email: "user@example.test", role: "CUSTOMER", status: "ACTIVE" },
      query: { page: "0" },
    } as unknown as Request;
    const res = response();

    await expect(getNotifications(req, res as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.getUserNotifications).not.toHaveBeenCalled();
  });

  it("marks a notification as read for the authenticated user", async () => {
    const req = {
      user: { id: "user-1", email: "user@example.test", role: "CUSTOMER", status: "ACTIVE" },
      params: { id: "notification-1" },
      requestId: "request-1",
    } as unknown as Request;
    const res = response();

    await markNotificationAsRead(req, res as unknown as Response);
    expect(mocks.markUserNotificationAsRead).toHaveBeenCalledWith("user-1", "notification-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
