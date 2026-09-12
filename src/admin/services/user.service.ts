import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

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