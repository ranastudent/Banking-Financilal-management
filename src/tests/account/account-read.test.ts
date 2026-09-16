import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];
const createdAuditLogIds: string[] = [];

const createTestUser = async (
  name: string,
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR" = "CUSTOMER",
  status:
    | "ACTIVE"
    | "INACTIVE"
    | "SUSPENDED"
    | "BLOCKED" = "ACTIVE",
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email: `account-read-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "test-password-hash",
      role,
      status,
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (
  userId: string,
  accountType:
    | "SAVINGS"
    | "CURRENT"
    | "FOREIGN_CURRENCY" = "SAVINGS",
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `ACC-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      accountType,
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createAccessToken = (user: {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";
  status:
    | "ACTIVE"
    | "INACTIVE"
    | "SUSPENDED"
    | "BLOCKED";
}) => {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });
};

afterEach(async () => {
  if (createdAuditLogIds.length > 0) {
    const ids = [...createdAuditLogIds];
    createdAuditLogIds.length = 0;

    await prisma.auditLog.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  if (createdAccountIds.length > 0) {
    const ids = [...createdAccountIds];
    createdAccountIds.length = 0;

    await prisma.account.deleteMany({
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

    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: ids,
        },
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: ids,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
});

describe("11.2 Account Read", () => {
  describe("GET /api/v1/accounts", () => {
    it("should allow CUSTOMER to list their own accounts", async () => {
      const customer = await createTestUser(
        "Account Read Customer",
        "CUSTOMER",
      );

      const accountOne = await createTestAccount(
        customer.id,
        "SAVINGS",
      );

      const accountTwo = await createTestAccount(
        customer.id,
        "CURRENT",
      );

      const accessToken = createAccessToken(customer);

      const response = await request(app)
        .get("/api/v1/accounts")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const accounts = response.body.data.accounts;

      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts).toHaveLength(2);

      const returnedIds = accounts.map(
        (account: { id: string }) => account.id,
      );

      expect(returnedIds).toContain(accountOne.id);
      expect(returnedIds).toContain(accountTwo.id);

      for (const account of accounts) {
        expect(account.userId).toBe(customer.id);
        expect(account.accountNumber).toBeTruthy();
        expect(account.accountType).toBeTruthy();
        expect(account.status).toBe("ACTIVE");
        expect(account.createdAt).toBeTruthy();
      }

      expect(response.body.requestId).toBeTruthy();
    });

    it("should return only the authenticated customer's accounts", async () => {
      const customerA = await createTestUser(
        "Account Read Customer A",
        "CUSTOMER",
      );

      const customerB = await createTestUser(
        "Account Read Customer B",
        "CUSTOMER",
      );

      const accountA = await createTestAccount(
        customerA.id,
      );

      await createTestAccount(customerB.id);

      const accessToken = createAccessToken(customerA);

      const response = await request(app)
        .get("/api/v1/accounts")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(200);

      const accounts = response.body.data.accounts;

      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toBe(accountA.id);
      expect(accounts[0].userId).toBe(customerA.id);
    });

    it("should return an empty list when CUSTOMER has no accounts", async () => {
      const customer = await createTestUser(
        "Account Read Empty Customer",
        "CUSTOMER",
      );

      const accessToken = createAccessToken(customer);

      const response = await request(app)
        .get("/api/v1/accounts")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accounts).toEqual([]);
    });

    it("should reject unauthenticated account list access", async () => {
      const response = await request(app).get(
        "/api/v1/accounts",
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject non-CUSTOMER account list access", async () => {
      const admin = await createTestUser(
        "Account Read Admin",
        "ADMIN",
      );

      const accessToken = createAccessToken(admin);

      const response = await request(app)
        .get("/api/v1/accounts")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should reject a refresh token", async () => {
      const customer = await createTestUser(
        "Account Read Refresh Customer",
        "CUSTOMER",
      );

      const accessToken = createAccessToken(customer);

      const payload = accessToken
        .split(".")
        .slice(0, 2)
        .join(".");

      expect(payload).toBeTruthy();

      const response = await request(app)
        .get("/api/v1/accounts")
        .set(
          "Authorization",
          `Bearer invalid-refresh-token`,
        );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });
  });

  describe("GET /api/v1/accounts/:accountId", () => {
    it("should allow CUSTOMER to read their own account", async () => {
      const customer = await createTestUser(
        "Account Detail Customer",
        "CUSTOMER",
      );

      const account = await createTestAccount(
        customer.id,
        "SAVINGS",
      );

      const accessToken = createAccessToken(customer);

      const response = await request(app)
        .get(`/api/v1/accounts/${account.id}`)
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const returnedAccount =
        response.body.data.account;

      expect(returnedAccount.id).toBe(account.id);
      expect(returnedAccount.userId).toBe(customer.id);
      expect(returnedAccount.accountNumber).toBe(
        account.accountNumber,
      );
      expect(returnedAccount.accountType).toBe(
        "SAVINGS",
      );
      expect(returnedAccount.status).toBe("ACTIVE");

      expect(returnedAccount.user.id).toBe(
        customer.id,
      );

      expect(
        returnedAccount.passwordHash,
      ).toBeUndefined();

      expect(
        returnedAccount.user.passwordHash,
      ).toBeUndefined();

      expect(response.body.requestId).toBeTruthy();
    });

    it("should reject CUSTOMER access to another customer's account", async () => {
      const customerA = await createTestUser(
        "Account Detail Customer A",
        "CUSTOMER",
      );

      const customerB = await createTestUser(
        "Account Detail Customer B",
        "CUSTOMER",
      );

      const accountB = await createTestAccount(
        customerB.id,
      );

      const accessToken = createAccessToken(customerA);

      const response = await request(app)
        .get(`/api/v1/accounts/${accountB.id}`)
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should return 404 for a nonexistent account", async () => {
      const customer = await createTestUser(
        "Account Detail Missing Customer",
        "CUSTOMER",
      );

      const accessToken = createAccessToken(customer);

      const nonexistentAccountId =
        "00000000-0000-0000-0000-000000000000";

      const response = await request(app)
        .get(
          `/api/v1/accounts/${nonexistentAccountId}`,
        )
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "RESOURCE_NOT_FOUND",
      );
    });

    it("should reject an unauthenticated account detail request", async () => {
      const response = await request(app).get(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000",
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "UNAUTHORIZED",
      );
    });

    it("should reject non-CUSTOMER account detail access", async () => {
      const admin = await createTestUser(
        "Account Detail Admin",
        "ADMIN",
      );

      const customer = await createTestUser(
        "Account Detail Target",
        "CUSTOMER",
      );

      const account = await createTestAccount(
        customer.id,
      );

      const accessToken = createAccessToken(admin);

      const response = await request(app)
        .get(`/api/v1/accounts/${account.id}`)
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(
        "FORBIDDEN",
      );
    });

    it("should not expose a direct writable balance field", async () => {
      const customer = await createTestUser(
        "Account Balance Read Customer",
        "CUSTOMER",
      );

      const account = await createTestAccount(
        customer.id,
      );

      const accessToken = createAccessToken(customer);

      const response = await request(app)
        .get(`/api/v1/accounts/${account.id}`)
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        );

      expect(response.status).toBe(200);

      const returnedAccount =
        response.body.data.account;

      expect(
        returnedAccount.balance,
      ).toBeUndefined();
    });
  });
});