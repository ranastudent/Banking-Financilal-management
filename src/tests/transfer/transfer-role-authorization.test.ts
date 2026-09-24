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

describe("14.3.2 Transfer Role Authorization", () => {
  const createdUserIds: string[] = [];
  const createdIdempotencyRecordIds: string[] = [];

  afterEach(async () => {
    /*
     * Delete idempotency records created by these tests.
     */
    if (createdUserIds.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });
    }

    if (createdIdempotencyRecordIds.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          id: {
            in: createdIdempotencyRecordIds,
          },
        },
      });

      createdIdempotencyRecordIds.length = 0;
    }

    /*
     * Delete user-dependent records before users.
     */
    if (createdUserIds.length > 0) {
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

  const createUser = async (
    role:
      | "CUSTOMER"
      | "ADMIN"
      | "SUPPORT"
      | "AUDITOR",
  ) => {
    const user = await prisma.user.create({
      data: {
        name: `Transfer Role ${Date.now()}-${Math.random()}`,
        email: `transfer-role-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccessToken = (user: {
    id: string;
    email: string;
    role:
      | "CUSTOMER"
      | "ADMIN"
      | "SUPPORT"
      | "AUDITOR";
  }) => {
    return generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: "ACTIVE",
    });
  };

  const createIdempotencyKey = (
    prefix: string,
  ) => {
    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  const transferPayload = {
    senderAccount: "ACC-1001",
    receiverAccount: "ACC-2002",
    amount: "5000.00",
    currency: "BDT",
  };

  it("should allow CUSTOMER to pass role authorization", async () => {
    const customer = await createUser("CUSTOMER");

    const accessToken =
      createAccessToken(customer);

    const response =
      await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "transfer-customer",
          ),
        )
        .send(transferPayload);

    /*
     * CUSTOMER is an allowed role.
     *
     * The request may fail later because the
     * test accounts do not necessarily exist.
     * It must NOT be rejected by RBAC.
     */
    expect(response.status).not.toBe(403);
  });

  it("should allow ADMIN to pass role authorization", async () => {
    const admin = await createUser("ADMIN");

    const accessToken =
      createAccessToken(admin);

    const response =
      await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "transfer-admin",
          ),
        )
        .send(transferPayload);

    /*
     * ADMIN is an allowed role.
     */
    expect(response.status).not.toBe(403);
  });

  it("should reject SUPPORT with 403", async () => {
    const support = await createUser("SUPPORT");

    const accessToken =
      createAccessToken(support);

    const response =
      await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .send(transferPayload);

    expect(response.status).toBe(403);

    expect(
      response.body.success,
    ).toBe(false);

    expect(
      response.body.error.code,
    ).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR with 403", async () => {
    const auditor = await createUser("AUDITOR");

    const accessToken =
      createAccessToken(auditor);

    const response =
      await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .send(transferPayload);

    expect(response.status).toBe(403);

    expect(
      response.body.success,
    ).toBe(false);

    expect(
      response.body.error.code,
    ).toBe("FORBIDDEN");
  });
});