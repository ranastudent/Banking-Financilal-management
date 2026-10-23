import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
import type { AuditContext } from "../../audit/audit.types";
import { cacheGroups, cacheService } from "../../services/cache.service";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { RegisterInput } from "../schemas/auth.schema";
import { hashPassword } from "../utils/password";
import { sendRegistrationOtp } from "./otp.service";

export const registerUser = async (
  input: RegisterInput,
  auditContext: AuditContext = {},
) => {
  const email = input.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new AppError(
      "Email is already registered",
      409,
      ErrorCode.CONFLICT,
    );
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        passwordHash,
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog(
      {
        userId: createdUser.id,
        action: "USER_REGISTERED",
        resource: "USER",
        resourceId: createdUser.id,
        description: "User registered.",
        ...auditContext,
        metadata: {
          role: createdUser.role,
          status: createdUser.status,
        },
      },
      tx,
    );

    return createdUser;
  });

  // Registration changes the total and ordering of the admin user list.
  await cacheService.invalidateGroup(cacheGroups.adminUsers);

  await sendRegistrationOtp(user.id, user.email);

  return user;
};