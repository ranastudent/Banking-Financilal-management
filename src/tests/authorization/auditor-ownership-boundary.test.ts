import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];

const createAuditor = async () => {
  const user = await prisma.user.create({
    data: {
      name: `Auditor Ownership ${crypto.randomUUID()}`,
      email: `auditor-ownership-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-password-hash",
      role: "AUDITOR",
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
  role: string;
  status: string;
}) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
};

afterEach(async () => {
  if (createdUserIds.length > 0) {
    const ids = [...createdUserIds];
    createdUserIds.length = 0;

    await prisma.user.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
});

describe("9.7.4 AUDITOR + Ownership Boundary", () => {
  it("should allow AUDITOR to access compliance read data without customer ownership restriction", async () => {
    const auditor = await createAuditor();

    const accessToken = createAccessToken(auditor);

    const response = await request(app)
      .get("/api/v1/auditor/audit-logs?page=1&limit=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body).toHaveProperty("data");
    expect(response.body).toHaveProperty("requestId");
  });

  it("should deny AUDITOR from performing a resource mutation", async () => {
    const auditor = await createAuditor();

    const accessToken = createAccessToken(auditor);

    const sourceAccountId = crypto.randomUUID();
    const destinationAccountId = crypto.randomUUID();

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccountId}/${destinationAccountId}`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: "100.00",
        currencyCode: "BDT",
        idempotencyKey: crypto.randomUUID(),
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});