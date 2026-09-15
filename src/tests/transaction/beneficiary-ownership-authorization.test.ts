import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const testPasswordHash =
  "$2b$10$7EqJtq98hPqEX7fNZaFWoOe3ZqX4M3H9l4z9B9j5c0B5l6VY6mL2a";

const createdBeneficiaryIds: string[] = [];
const createdUserIds: string[] = [];

const createCustomer = async (suffix: string) => {
  const user = await prisma.user.create({
    data: {
      name: "Beneficiary Ownership Customer",
      email: `beneficiary-ownership-${suffix}-${Date.now()}@example.com`,
      passwordHash: testPasswordHash,
      role: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createBeneficiary = async (userId: string) => {
  const beneficiary = await prisma.beneficiary.create({
    data: {
      userId,
      beneficiaryType: "INTERNAL",
      displayName: "Ownership Test Beneficiary",
      accountReference: `ACC-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      provider: "INTERNAL",
      currencyCode: "BDT",
      status: "ACTIVE",
    },
  });

  createdBeneficiaryIds.push(beneficiary.id);

  return beneficiary;
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
  if (createdBeneficiaryIds.length > 0) {
    await prisma.beneficiary.deleteMany({
      where: {
        id: {
          in: createdBeneficiaryIds,
        },
      },
    });

    createdBeneficiaryIds.length = 0;
  }

  if (createdUserIds.length > 0) {
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

describe("9.6.3 Beneficiary Ownership Authorization", () => {
  it("should allow CUSTOMER to access their own beneficiary", async () => {
    const customer = await createCustomer("own");

    const beneficiary = await createBeneficiary(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.beneficiary.id).toBe(
      beneficiary.id,
    );

    expect(response.body.data.beneficiary.userId).toBe(
      customer.id,
    );
  });

  it("should deny CUSTOMER access to another customer's beneficiary", async () => {
    const customerA = await createCustomer("customer-a");
    const customerB = await createCustomer("customer-b");

    const beneficiaryB = await createBeneficiary(customerB.id);

    const accessToken = createAccessToken(customerA);

    const response = await request(app)
      .get(`/api/v1/beneficiaries/${beneficiaryB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});