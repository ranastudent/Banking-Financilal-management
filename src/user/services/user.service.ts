import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { prisma } from "../../config/prisma";
import { deleteCache, getCache, setCache } from "../../services/cache.service";

const PROFILE_CACHE_TTL_SECONDS = 60;
const profileCacheKey = (userId: string) => `cache:user-profile:${userId}`;

type SafeUserProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CachedSafeUser = Omit<
  SafeUserProfile,
  "emailVerifiedAt" | "createdAt" | "updatedAt"
> & {
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export const getCurrentUser = async (userId: string): Promise<SafeUserProfile | null> => {
  const cached = await getCache<CachedSafeUser>(profileCacheKey(userId));

  if (cached) {
    return {
      ...cached,
      emailVerifiedAt: cached.emailVerifiedAt
        ? new Date(cached.emailVerifiedAt)
        : null,
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: SAFE_USER_SELECT,
  });

  if (user) {
    const cacheValue: CachedSafeUser = {
      ...user,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      role: String(user.role),
      status: String(user.status),
    };

    await setCache(
      profileCacheKey(userId),
      cacheValue,
      PROFILE_CACHE_TTL_SECONDS,
    );
  }

  return user;
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

    await deleteCache(profileCacheKey(userId));

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