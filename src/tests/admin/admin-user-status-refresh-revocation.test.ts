import crypto from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../auth/utils/jwt";
import { hashPassword } from "../../auth/utils/password";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";
import type { AuthUser } from "../../types/auth";
import { UserRole, UserStatus } from "@prisma/client";

describe(
  "Admin User Status - Refresh Token Revocation",
  () => {
    const userPassword = "StrongPassword123!";

    const createdUserIds: string[] = [];

    const createTestEmail = (label: string) =>
      `${label}.${crypto.randomUUID()}@example.com`;

    afterEach(async () => {
      if (createdUserIds.length === 0) {
        return;
      }

      const userIds = [...createdUserIds];
      createdUserIds.length = 0;

      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      await prisma.emailVerificationOtp.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: userIds,
          },
        },
      });
    });

    const createUser = async (
      role: "CUSTOMER" | "ADMIN" = "CUSTOMER",
    ) => {
      const email = createTestEmail("refresh-revocation");
      const passwordHash =
        await hashPassword(userPassword);

      const user = await prisma.user.create({
        data: {
          name: "Refresh Revocation User",
          email,
          passwordHash,
          role,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      return user;
    };

    const createAuthUser = (
    user: {
        id: string;
        email: string;
        role: UserRole;
        status: UserStatus;
    },
    ): AuthUser => {
    if (user.status === "INACTIVE") {
        throw new Error(
        "INACTIVE user cannot be used for authentication test setup",
        );
    }

    return {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
    };
    };

    it(
      "should revoke an existing refresh token when ADMIN blocks a user",
      async () => {
        const admin = await createUser("ADMIN");
        const customer = await createUser("CUSTOMER");

        const customerAuthUser =
          createAuthUser(customer);

        const adminAuthUser =
          createAuthUser(admin);

        const customerAccessToken =
          generateAccessToken(customerAuthUser);

        const customerRefreshToken =
          generateRefreshToken(customerAuthUser);

        const adminAccessToken =
          generateAccessToken(adminAuthUser);

        await prisma.refreshToken.create({
          data: {
            userId: customer.id,
            tokenHash: hashRefreshToken(
              customerRefreshToken,
            ),
            expiresAt: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ),
          },
        });

        const storedBefore =
          await prisma.refreshToken.findMany({
            where: {
              userId: customer.id,
              revokedAt: null,
            },
          });

        expect(storedBefore).toHaveLength(1);

        const blockResponse =
          await request(app)
            .patch(
              `/api/v1/admin/users/${customer.id}/status`,
            )
            .set(
              "Authorization",
              `Bearer ${adminAccessToken}`,
            )
            .send({
              status: "BLOCKED",
            });

        expect(blockResponse.status).toBe(200);
        expect(
          blockResponse.body.data.status,
        ).toBe("BLOCKED");

        const storedAfter =
          await prisma.refreshToken.findMany({
            where: {
              userId: customer.id,
            },
            select: {
              tokenHash: true,
              revokedAt: true,
            },
          });

        expect(storedAfter).toHaveLength(1);
        expect(storedAfter[0]?.revokedAt).not.toBeNull();

        const refreshResponse =
          await request(app)
            .post("/api/v1/auth/refresh")
            .send({
              refreshToken: customerRefreshToken,
            });

        expect(refreshResponse.status).toBe(401);
        expect(
          refreshResponse.body.success,
        ).toBe(false);
        expect(
          refreshResponse.body.error.code,
        ).toBe("UNAUTHORIZED");

        expect(customerAccessToken).toEqual(
          expect.any(String),
        );
      },
    );

    it(
      "should revoke all active refresh tokens when ADMIN suspends a user",
      async () => {
        const admin = await createUser("ADMIN");
        const customer = await createUser("CUSTOMER");

        const customerAuthUser =
          createAuthUser(customer);

        const adminAuthUser =
          createAuthUser(admin);

        const firstRefreshToken =
          generateRefreshToken(customerAuthUser);

        const secondRefreshToken =
          generateRefreshToken(customerAuthUser);

        const adminAccessToken =
          generateAccessToken(adminAuthUser);

        await prisma.refreshToken.createMany({
          data: [
            {
              userId: customer.id,
              tokenHash: hashRefreshToken(
                firstRefreshToken,
              ),
              expiresAt: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ),
            },
            {
              userId: customer.id,
              tokenHash: hashRefreshToken(
                secondRefreshToken,
              ),
              expiresAt: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ),
            },
          ],
        });

        const blockResponse =
          await request(app)
            .patch(
              `/api/v1/admin/users/${customer.id}/status`,
            )
            .set(
              "Authorization",
              `Bearer ${adminAccessToken}`,
            )
            .send({
              status: "SUSPENDED",
            });

        expect(blockResponse.status).toBe(200);
        expect(
          blockResponse.body.data.status,
        ).toBe("SUSPENDED");

        const storedTokens =
          await prisma.refreshToken.findMany({
            where: {
              userId: customer.id,
            },
            select: {
              revokedAt: true,
            },
          });

        expect(storedTokens).toHaveLength(2);

        for (const token of storedTokens) {
          expect(token.revokedAt).not.toBeNull();
        }
      },
    );
  },
);