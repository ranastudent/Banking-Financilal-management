import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { prisma } from "../../config/prisma";
import { cacheGroups, cacheKeys, cacheService } from "../../services/cache.service";

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getCurrentUser = async (userId: string) => {
  return cacheService.getOrSet(
    cacheKeys.userProfile(userId),
    () => prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    }),
    30,
    [cacheGroups.user(userId)],
  );
};

export const updateCurrentUser = async (
  userId: string,
  input: {
    name?: string | undefined;
    phone?: string | null | undefined;
  },
) => {
  if (Object.keys(input).length === 0) {
    throw new AppError(
      "At least one profile field is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
    },
  });

  if (!existingUser) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.NOT_FOUND,
    );
  }

  const updateData = {
    ...(input.name !== undefined
      ? { name: input.name }
      : {}),
    ...(input.phone !== undefined
      ? { phone: input.phone }
      : {}),
  };

  try {
    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: updateData,
      select: SAFE_USER_SELECT,
    });

    // Invalidate only after PostgreSQL has committed the profile update.
    await Promise.all([
      cacheService.invalidateGroup(cacheGroups.user(userId)),
      cacheService.invalidateGroup(cacheGroups.adminUser(userId)),
      cacheService.invalidateGroup(cacheGroups.adminUsers),
    ]);

    return updatedUser;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new AppError(
        "Phone number is already in use",
        409,
        ErrorCode.CONFLICT,
      );
    }

    throw error;
  }
};