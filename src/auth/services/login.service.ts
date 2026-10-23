import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { LoginInput } from "../schemas/auth.schema";
import { comparePassword } from "../utils/password";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt";
import { hashRefreshToken } from "../utils/refreshTokenHash";
import { writeAuditLog, writeSecurityAuditLogSafely } from "../../audit/audit.service";
import type { AuditContext } from "../../audit/audit.types";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

export const loginUser = async (
  input: LoginInput,
  auditContext: AuditContext = {},
) => {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    await writeSecurityAuditLogSafely({
      action: "LOGIN_FAILED",
      resource: "USER",
      userId: null,
      success: false,
      failureReason: "Invalid credentials",
      ...auditContext,
      metadata: { attemptedEmail: email },
    });

    throw new AppError(
      INVALID_CREDENTIALS_MESSAGE,
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (!user.emailVerifiedAt) {
    await writeSecurityAuditLogSafely({
      action: "LOGIN_FAILED",
      resource: "USER",
      resourceId: user.id,
      userId: user.id,
      success: false,
      failureReason: "Email not verified",
      ...auditContext,
      metadata: { reason: "EMAIL_NOT_VERIFIED" },
    });

    throw new AppError(
      "Please verify your email before logging in",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (user.status !== "ACTIVE") {
    await writeSecurityAuditLogSafely({
      action: "LOGIN_FAILED",
      resource: "USER",
      resourceId: user.id,
      userId: user.id,
      success: false,
      failureReason: "Account is not active",
      ...auditContext,
      metadata: { accountStatus: user.status },
    });

    throw new AppError(
      "Your account is not active",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const passwordMatches = await comparePassword(
    input.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    await writeSecurityAuditLogSafely({
      action: "LOGIN_FAILED",
      resource: "USER",
      resourceId: user.id,
      userId: user.id,
      success: false,
      failureReason: "Invalid credentials",
      ...auditContext,
      metadata: { reason: "INVALID_CREDENTIALS" },
    });

    throw new AppError(
      INVALID_CREDENTIALS_MESSAGE,
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  const accessToken = generateAccessToken(authUser);
  const refreshToken = generateRefreshToken(authUser);

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const expiresAt = new Date(
    Date.now() +
      REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.$transaction(async (tx) => {
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt,
      },
    });

    await writeAuditLog(
      {
        userId: user.id,
        action: "LOGIN",
        resource: "USER",
        resourceId: user.id,
        description: "User logged in successfully.",
        success: true,
        ...auditContext,
        metadata: { role: user.role },
      },
      tx,
    );
  });

  // Security alerts are an asynchronous side effect. Do not turn a successful
  // login into a failed login if outbox persistence has a transient problem.
  // Other financial notifications use an outbox event in their business
  // transaction; login alert reliability can be tightened by moving token
  // creation and this insert into one transaction in a later auth hardening pass.
  if (prisma.outboxEvent?.create) {
    try {
      await prisma.outboxEvent.create({
        data: {
          eventType: "NOTIFICATION_REQUESTED",
          payload: {
            userId: user.id,
            notificationType: "SECURITY_ALERT",
            title: "New sign-in",
            message: "A successful sign-in to your banking platform account occurred. If this was not you, contact support immediately.",
            metadata: {
              event: "SUCCESSFUL_LOGIN",
            },
          },
        },
      });
    } catch (error) {
      console.error("[auth] unable to record successful-login security alert", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    accessToken,
    refreshToken,
  };
};