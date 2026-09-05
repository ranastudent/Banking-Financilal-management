import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { compareOtp } from "../utils/otpHash";
import type { VerifyEmailInput } from "../schemas/verifyEmail.schema";

export const verifyEmail = async (input: VerifyEmailInput) => {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.NOT_FOUND,
    );
  }

  if (user.emailVerifiedAt) {
    throw new AppError(
      "Email is already verified",
      409,
      ErrorCode.CONFLICT,
    );
  }

  const otpRecord = await prisma.emailVerificationOtp.findFirst({
    where: {
      userId: user.id,
      verifiedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!otpRecord) {
    throw new AppError(
      "Verification OTP not found",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (otpRecord.expiresAt <= new Date()) {
    throw new AppError(
      "Verification OTP has expired",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const isValidOtp = await compareOtp(
    input.otp,
    otpRecord.otpHash,
  );

  if (!isValidOtp) {
    throw new AppError(
      "Invalid verification OTP",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: {
        id: user.id,
      },
      data: {
        emailVerifiedAt: now,
        status: "ACTIVE",
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

    await tx.emailVerificationOtp.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        verifiedAt: now,
      },
    });

    return updatedUser;
  });

  return result;
};