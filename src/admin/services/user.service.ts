import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { revokeAllRefreshTokensForUser } from "../../auth/services/token-revocation.service";

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

export const getAdminUsers = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_USER_SELECT,
    }),
    prisma.user.count(),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminUserById = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: SAFE_USER_SELECT,
  });

  if (!user) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return user;
};

export const updateAdminUserStatus = async (
  userId: string,
  status: "ACTIVE" | "BLOCKED" | "SUSPENDED",
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
) => {
  const updatedUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!user) {
      throw new AppError(
        "User not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    // No real change → no audit entry
    if (user.status === status) {
      return tx.user.findUnique({
        where: {
          id: userId,
        },
        select: SAFE_USER_SELECT,
      });
    }

    const updated = await tx.user.update({
      where: {
        id: userId,
      },
      data: {
        status,
      },
      select: SAFE_USER_SELECT,
    });

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "USER_STATUS_CHANGED",
        entityType: "USER",
        entityId: user.id,
        description: `User ${user.id} status changed from ${user.status} to ${status}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          previousStatus: user.status,
          newStatus: status,
        },
      },
    });

    return updated;
  });

  // Revoke refresh tokens after BLOCKED/SUSPENDED
  if (status === "BLOCKED" || status === "SUSPENDED") {
    await revokeAllRefreshTokensForUser(userId);
  }

  return updatedUser;
};