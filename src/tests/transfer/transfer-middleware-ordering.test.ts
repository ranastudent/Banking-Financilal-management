import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

describe(
  "14.3.4 Authentication Middleware Ordering",
  () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
      if (createdUserIds.length > 0) {
        await prisma.idempotencyRecord.deleteMany({
          where: {
            userId: {
              in: createdUserIds,
            },
          },
        });

        await prisma.refreshToken.deleteMany({
          where: {
            userId: {
              in: createdUserIds,
            },
          },
        });

        await prisma.emailVerificationOtp.deleteMany({
          where: {
            userId: {
              in: createdUserIds,
            },
          },
        });

        await prisma.auditLog.deleteMany({
          where: {
            userId: {
              in: createdUserIds,
            },
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: {
              in: createdUserIds,
            },
          },
        });

        createdUserIds.length = 0;
      }
    });

    const createUser = async () => {
      const user = await prisma.user.create({
        data: {
          name:
            `Transfer Ordering ${Date.now()}-${Math.random()}`,

          email:
            `transfer-ordering-${Date.now()}-${Math.random()}@example.com`,

          passwordHash: "test-password-hash",

          role: "CUSTOMER",

          status: "ACTIVE",

          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      return user;
    };

    const createAccessToken = (
      user: Awaited<ReturnType<typeof createUser>>,
    ) => {
      return generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      });
    };

    const transferPayload = {
      senderAccount: "ACC-1001",
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
    };

    it(
      "should authenticate before idempotency when JWT is missing",
      async () => {
        const response = await request(app)
          .post("/api/v1/transfers")
          .send(transferPayload);

        expect(response.status).toBe(401);

        expect(
          response.body.success,
        ).toBe(false);

        expect(
          response.body.error.code,
        ).toBe("UNAUTHORIZED");

        expect(
          response.body.error.message,
        ).not.toBe(
          "Idempotency-Key header is required",
        );
      },
    );

    it(
      "should authenticate before idempotency when JWT is invalid",
      async () => {
        const response = await request(app)
          .post("/api/v1/transfers")
          .set(
            "Authorization",
            "Bearer invalid-access-token",
          )
          .send(transferPayload);

        expect(response.status).toBe(401);

        expect(
          response.body.success,
        ).toBe(false);

        expect(
          response.body.error.code,
        ).toBe("UNAUTHORIZED");

        expect(
          response.body.error.message,
        ).not.toBe(
          "Idempotency-Key header is required",
        );
      },
    );

    it(
      "should reach idempotency only after successful authentication",
      async () => {
        const user = await createUser();

        const accessToken =
          createAccessToken(user);

        const response = await request(app)
          .post("/api/v1/transfers")
          .set(
            "Authorization",
            `Bearer ${accessToken}`,
          )
          .send(transferPayload);

        expect(response.status).toBe(400);

        expect(
          response.body.success,
        ).toBe(false);

        expect(
          response.body.error.code,
        ).toBe("BAD_REQUEST");

        expect(
          response.body.error.message,
        ).toBe(
          "Idempotency-Key header is required",
        );
      },
    );
  },
);