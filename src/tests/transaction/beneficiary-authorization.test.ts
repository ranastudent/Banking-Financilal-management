import { describe, expect, it, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import crypto from "node:crypto";

const testPasswordHash =
  "$2b$10$7EqJtq98hPqEX7fNZaFWoOe3ZqX4M3H9l4z9B9j5c0B5l6VY6mL2a";

const createdUserIds: string[] = [];

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  suffix: string,
) => {
  const user = await prisma.user.create({
    data: {
      name: `${role} Test User`,
      email: `${role.toLowerCase()}-${suffix}-${Date.now()}@example.com`,
      passwordHash: testPasswordHash,
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createBeneficiary = async (userId: string) => {
  return prisma.beneficiary.create({
    data: {
      userId,
      beneficiaryType: "INTERNAL",
      displayName: "Test Beneficiary",
      accountReference: `ACC-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      provider: "INTERNAL",
      currencyCode: "BDT",
      status: "ACTIVE",
    },
  });
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

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: crypto.randomUUID(),
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

describe("Own Beneficiary Authorization", () => {
  afterEach(async () => {
  if (createdUserIds.length === 0) {
    return;
  }

  await prisma.beneficiary.deleteMany({
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
});

  it("should allow CUSTOMER to view their own beneficiary", async () => {
    const customer = await createUser("CUSTOMER", "own");
    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.beneficiary.id).toBe(beneficiary.id);
    expect(response.body.data.beneficiary.userId).toBe(customer.id);
  });

  it("should reject CUSTOMER from viewing another customer's beneficiary", async () => {
    const customerA = await createUser("CUSTOMER", "a");
    const customerB = await createUser("CUSTOMER", "b");

    const beneficiary = await createBeneficiary(customerB.id);

    const token = createAccessToken(customerA);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to view any beneficiary", async () => {
    const admin = await createUser("ADMIN", "admin");
    const customer = await createUser("CUSTOMER", "customer");

    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.beneficiary.id).toBe(beneficiary.id);
  });

  it("should allow SUPPORT to view a beneficiary", async () => {
    const support = await createUser("SUPPORT", "support");
    const customer = await createUser("CUSTOMER", "customer");

    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.beneficiary.id).toBe(beneficiary.id);
  });

  it("should allow AUDITOR to view a beneficiary", async () => {
    const auditor = await createUser("AUDITOR", "auditor");
    const customer = await createUser("CUSTOMER", "customer");

    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.beneficiary.id).toBe(beneficiary.id);
  });

  it("should return 404 when beneficiary does not exist", async () => {
    const customer = await createUser("CUSTOMER", "missing");
    const token = createAccessToken(customer);

    const missingId = "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${missingId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject unauthenticated access", async () => {
    const response = await request(app).get(
      "/api/v1/beneficiaries/00000000-0000-0000-0000-000000000000",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the beneficiary route", async () => {
    const customer = await createUser("CUSTOMER", "refresh");

    const refreshToken = createRefreshToken(customer.id);

    const response = await request(app)
      .get("/api/v1/beneficiaries/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should not expose sensitive authentication data", async () => {
    const customer = await createUser("CUSTOMER", "sensitive");
    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const bodyText = JSON.stringify(response.body);

    expect(bodyText).not.toContain("passwordHash");
    expect(bodyText).not.toContain("password");
    expect(bodyText).not.toContain(env.jwtAccessSecret);
    expect(bodyText).not.toContain(env.jwtRefreshSecret);
    expect(bodyText).not.toContain(token);
  });

  it("should include requestId for an authorized beneficiary request", async () => {
    const customer = await createUser("CUSTOMER", "request-id");
    const beneficiary = await createBeneficiary(customer.id);

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });
});