import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export type NotificationListOptions = {
  page: number;
  limit: number;
  unreadOnly?: boolean;
};

const visibleStatuses = ["SENT", "READ"] as const;

export const getUserNotifications = async (
  userId: string,
  options: NotificationListOptions,
) => {
  const { page, limit, unreadOnly = false } = options;
  const where: Prisma.NotificationWhereInput = {
    userId,
    status: unreadOnly ? "SENT" : { in: [...visibleStatuses] },
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        type: true,
        title: true,
        message: true,
        channel: true,
        status: true,
        metadata: true,
        createdAt: true,
        readAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { userId, status: "SENT" },
    }),
  ]);

  return {
    notifications,
    unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const markUserNotificationAsRead = async (
  userId: string,
  notificationId: string,
) => {
  // Scope the lookup to the authenticated owner to prevent IDOR.
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: {
      id: true,
      userId: true,
      type: true,
      title: true,
      message: true,
      channel: true,
      status: true,
      metadata: true,
      createdAt: true,
      readAt: true,
    },
  });

  if (!existing) {
    throw new AppError(
      "Notification not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (existing.status === "READ") return existing;

  if (existing.status !== "SENT") {
    throw new AppError(
      "This notification cannot be marked as read",
      409,
      ErrorCode.CONFLICT,
    );
  }

  const now = new Date();
  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
      status: "SENT",
    },
    data: {
      status: "READ",
      readAt: now,
    },
  });

  // Re-read after the conditional update so concurrent requests are safe.
  const updated = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: {
      id: true,
      userId: true,
      type: true,
      title: true,
      message: true,
      channel: true,
      status: true,
      metadata: true,
      createdAt: true,
      readAt: true,
    },
  });

  if (!updated) {
    throw new AppError(
      "Notification not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return updated;
};
