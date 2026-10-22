import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const testPasswordHash = "test-beneficiary-password-hash";
const createdUserIds: string[] = [];

const createCustomer = async (suffix: string) => {
  const user = await prisma.user.create({
    data: {
      name: `Beneficiary Test ${suffix}`,
      email: `beneficiary-management-${suffix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}@example.com`,
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
  return prisma.beneficiary.create({
    data: {
      userId,
      beneficiaryType: "INTERNAL",
      displayName: "Existing Beneficiary",
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
}) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    { expiresIn: "15m" },
  );

const beneficiaryBody = {
  beneficiaryType: "INTERNAL",
  displayName: "My New Beneficiary",
  accountReference: "INTERNAL-ACCOUNT-12345",
  provider: "INTERNAL",
  currencyCode: "BDT",
};

afterEach(async () => {
  if (createdUserIds.length === 0) return;

  await prisma.beneficiary.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: createdUserIds } },
  });

  createdUserIds.length = 0;
});

describe("Phase 20 — Beneficiary Management", () => {
  it("creates a beneficiary owned by the authenticated customer", async () => {
    const customer = await createCustomer("create");
    const token = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/beneficiaries")
      .set("Authorization", `Bearer ${token}`)
      .send(beneficiaryBody);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.beneficiary.userId).toBe(customer.id);
    expect(response.body.data.beneficiary.displayName).toBe(
      beneficiaryBody.displayName,
    );
  });

  it("rejects a client-supplied userId", async () => {
    const customer = await createCustomer("no-owner-injection");
    const token = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/beneficiaries")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...beneficiaryBody, userId: "00000000-0000-4000-8000-000000000001" });

    expect(response.status).toBe(400);
  });

  it("lists only the authenticated customer's beneficiaries", async () => {
    const customerA = await createCustomer("list-a");
    const customerB = await createCustomer("list-b");
    await createBeneficiary(customerA.id);
    await createBeneficiary(customerB.id);

    const response = await request(app)
      .get("/api/v1/beneficiaries")
      .set("Authorization", `Bearer ${createAccessToken(customerA)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.beneficiaries).toHaveLength(1);
    expect(response.body.data.beneficiaries[0].userId).toBe(customerA.id);
  });

  it("updates a beneficiary owned by the authenticated customer", async () => {
    const customer = await createCustomer("update-own");
    const beneficiary = await createBeneficiary(customer.id);

    const response = await request(app)
      .patch(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${createAccessToken(customer)}`)
      .send({ displayName: "Updated Name" });

    expect(response.status).toBe(200);
    expect(response.body.data.beneficiary.displayName).toBe("Updated Name");
  });

  it("does not allow a customer to update another customer's beneficiary", async () => {
    const customerA = await createCustomer("update-a");
    const customerB = await createCustomer("update-b");
    const beneficiaryB = await createBeneficiary(customerB.id);

    const response = await request(app)
      .patch(`/api/v1/beneficiaries/${beneficiaryB.id}`)
      .set("Authorization", `Bearer ${createAccessToken(customerA)}`)
      .send({ displayName: "Unauthorized Update" });

    expect(response.status).toBe(404);

    const unchanged = await prisma.beneficiary.findUniqueOrThrow({
      where: { id: beneficiaryB.id },
    });
    expect(unchanged.displayName).toBe("Existing Beneficiary");
  });

  it("deletes a beneficiary owned by the authenticated customer", async () => {
    const customer = await createCustomer("delete-own");
    const beneficiary = await createBeneficiary(customer.id);

    const response = await request(app)
      .delete(`/api/v1/beneficiaries/${beneficiary.id}`)
      .set("Authorization", `Bearer ${createAccessToken(customer)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.deleted).toBe(true);
    expect(
      await prisma.beneficiary.findUnique({ where: { id: beneficiary.id } }),
    ).toBeNull();
  });

  it("does not allow a customer to delete another customer's beneficiary", async () => {
    const customerA = await createCustomer("delete-a");
    const customerB = await createCustomer("delete-b");
    const beneficiaryB = await createBeneficiary(customerB.id);

    const response = await request(app)
      .delete(`/api/v1/beneficiaries/${beneficiaryB.id}`)
      .set("Authorization", `Bearer ${createAccessToken(customerA)}`);

    expect(response.status).toBe(404);
    expect(
      await prisma.beneficiary.findUnique({ where: { id: beneficiaryB.id } }),
    ).not.toBeNull();
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .get("/api/v1/beneficiaries");

    expect(response.status).toBe(401);
  });
});
