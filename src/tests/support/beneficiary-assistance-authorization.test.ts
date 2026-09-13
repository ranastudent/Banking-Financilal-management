import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdBeneficiaryIds: string[] = [];
const createdUserIds: string[] = [];

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Beneficiary Assistance ${role} ${crypto.randomUUID()}`,
      email: `beneficiary-assistance-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      phone: null,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createBeneficiary = async (
  userId: string,
  overrides: {
    displayName?: string;
    status?:
      | "ACTIVE"
      | "INACTIVE"
      | "BLOCKED";
  } = {},
) => {
  const beneficiary =
    await prisma.beneficiary.create({
      data: {
        userId,
        beneficiaryType: "INTERNAL",
        displayName:
          overrides.displayName ??
          "Support Test Beneficiary",
        accountReference: `BA-${Date.now()}-${crypto
          .randomUUID()
          .slice(0, 8)}`,
        provider: "INTERNAL",
        currencyCode: "BDT",
        status: overrides.status ?? "ACTIVE",
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

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: `beneficiary-assistance-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdBeneficiaryIds.length > 0) {
    const ids = [...createdBeneficiaryIds];
    createdBeneficiaryIds.length = 0;

    await prisma.beneficiary.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

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

describe(
  "SUPPORT Beneficiary Assistance Authorization",
  () => {
    it("should allow SUPPORT to view a customer's beneficiary", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      expect(
        response.body.data.beneficiary.id,
      ).toBe(beneficiary.id);

      expect(
        response.body.data.beneficiary.userId,
      ).toBe(customer.id);
    });

    it("should return beneficiary assistance data safely", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id, {
          displayName: "Rahim Beneficiary",
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const returnedBeneficiary =
        response.body.data.beneficiary;

      expect(
        returnedBeneficiary.displayName,
      ).toBe("Rahim Beneficiary");

      expect(
        returnedBeneficiary.beneficiaryType,
      ).toBe("INTERNAL");

      expect(
        returnedBeneficiary.accountReference,
      ).toBe(beneficiary.accountReference);

      expect(
        returnedBeneficiary.provider,
      ).toBe("INTERNAL");

      expect(
        returnedBeneficiary.currencyCode.trim(),
      ).toBe("BDT");

      expect(
        returnedBeneficiary.status,
      ).toBe("ACTIVE");
    });

    it("should reject SUPPORT from viewing another customer's beneficiary", async () => {
      const support = await createUser("SUPPORT");
      const customerA = await createUser("CUSTOMER");
      const customerB = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customerB.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customerA.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject a non-customer target", async () => {
      const support = await createUser("SUPPORT");
      const admin = await createUser("ADMIN");

      const beneficiary =
        await createBeneficiary(admin.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${admin.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should return 404 for a nonexistent beneficiary", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/00000000-0000-0000-0000-000000000000`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject CUSTOMER access", async () => {
      const customer = await createUser("CUSTOMER");
      const targetCustomer = await createUser(
        "CUSTOMER",
      );

      const beneficiary =
        await createBeneficiary(targetCustomer.id);

      const token = createAccessToken(customer);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${targetCustomer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject ADMIN access", async () => {
      const admin = await createUser("ADMIN");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const token = createAccessToken(admin);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject AUDITOR access", async () => {
      const auditor = await createUser("AUDITOR");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const token = createAccessToken(auditor);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject unauthenticated access", async () => {
      const customer = await createUser("CUSTOMER");
      const beneficiary =
        await createBeneficiary(customer.id);

      const response = await request(app).get(
        `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject a refresh token", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const refreshToken =
        createRefreshToken(support.id);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set(
          "Authorization",
          `Bearer ${refreshToken}`,
        );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject invalid customer ID", async () => {
      const support = await createUser("SUPPORT");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          "/api/v1/support/customers/not-a-uuid/beneficiaries/00000000-0000-0000-0000-000000000000",
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject invalid beneficiary ID", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/not-a-uuid`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should not expose sensitive authentication data", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const bodyText = JSON.stringify(response.body);

      expect(bodyText).not.toContain("passwordHash");
      expect(bodyText).not.toContain("password");
      expect(bodyText).not.toContain(
        env.jwtAccessSecret,
      );
      expect(bodyText).not.toContain(
        env.jwtRefreshSecret,
      );
      expect(bodyText).not.toContain(token);
    });

    it("should include requestId", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
      expect(
        typeof response.body.requestId,
      ).toBe("string");
    });

    it("should be read-only and not modify the beneficiary", async () => {
      const support = await createUser("SUPPORT");
      const customer = await createUser("CUSTOMER");

      const beneficiary =
        await createBeneficiary(customer.id);

      const before =
        await prisma.beneficiary.findUnique({
          where: {
            id: beneficiary.id,
          },
        });

      const token = createAccessToken(support);

      const response = await request(app)
        .get(
          `/api/v1/support/customers/${customer.id}/beneficiaries/${beneficiary.id}`,
        )
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);

      const after =
        await prisma.beneficiary.findUnique({
          where: {
            id: beneficiary.id,
          },
        });

      expect(before).not.toBeNull();
      expect(after).not.toBeNull();

      expect(after?.userId).toBe(before?.userId);
      expect(after?.displayName).toBe(
        before?.displayName,
      );
      expect(after?.status).toBe(before?.status);
      expect(after?.accountReference).toBe(
        before?.accountReference,
      );
    });
  },
);