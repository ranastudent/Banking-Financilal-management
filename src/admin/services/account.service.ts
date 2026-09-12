import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const SAFE_ACCOUNT_SELECT = {
  id: true,
  userId: true,
  accountNumber: true,
  accountType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
    },
  },
} as const;

export const getAdminAccounts = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [accounts, total] = await prisma.$transaction([
    prisma.account.findMany({
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_ACCOUNT_SELECT,
    }),

    prisma.account.count(),
  ]);

  return {
    accounts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminAccountById = async (
  accountId: string,
) => {
  const account = await prisma.account.findUnique({
    where: {
      id: accountId,
    },
    select: SAFE_ACCOUNT_SELECT,
  });

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account;
};