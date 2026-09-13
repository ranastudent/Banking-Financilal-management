import { prisma } from "../../config/prisma";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

const SAFE_CUSTOMER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

export const lookupCustomers = async (
  user: AuthUser,
  query: string,
  page: number,
  limit: number,
) => {
  assertSupportPermission(
    user,
    SupportPermission.CUSTOMER_LOOKUP,
  );

  const skip = (page - 1) * limit;

  const where = {
    role: "CUSTOMER" as const,
    OR: [
      {
        name: {
          contains: query,
          mode: "insensitive" as const,
        },
      },
      {
        email: {
          contains: query,
          mode: "insensitive" as const,
        },
      },
      {
        phone: {
          contains: query,
          mode: "insensitive" as const,
        },
      },
    ],
  };

  const [customers, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_CUSTOMER_SELECT,
    }),

    prisma.user.count({
      where,
    }),
  ]);

  return {
    customers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};