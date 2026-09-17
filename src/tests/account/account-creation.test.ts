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

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR" = "CUSTOMER",
  status:
    | "ACTIVE"
    | "INACTIVE"
    | "SUSPENDED"
    | "BLOCKED" = "ACTIVE",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Account Creation ${Date.now()}-${Math.random()}`,
      email: `account-create-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "test-password-hash",
      role,
      status,
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
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

const cleanup = async () => {
  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: {
          in: createdAccountIds,
        },
      },
    });

    createdAccountIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.refreshToken.deleteMany({
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
};

afterEach(async () => {
  await cleanup();
});

describe("11.1 Account Creation", () => {
  it("should allow an active CUSTOMER to create a SAVINGS account", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const account = response.body.data.account;

    expect(account.id).toBeTruthy();
    expect(account.accountNumber).toBeTruthy();
    expect(account.accountType).toBe("SAVINGS");
    expect(account.status).toBe("ACTIVE");

    expect(account.user.id).toBe(customer.id);
    expect(account.user.email).toBe(customer.email);

    expect(account.balances).toHaveLength(1);

    expect(account.balances[0].currencyCode).toBe("BDT");
    expect(account.balances[0].availableBalance).toBe("0");
    expect(account.balances[0].lockedBalance).toBe("0");

    /*
     * Balance must not be exposed as a writable Account field.
     * It is derived from AccountBalance.
     */
    expect(account.balance).toBeUndefined();

    expect(response.body.requestId).toBeTruthy();

    const createdAccount = await prisma.account.findUnique({
      where: {
        id: account.id,
      },
    });

    expect(createdAccount).not.toBeNull();

    if (!createdAccount) {
      throw new Error("Account was not created");
    }

    createdAccountIds.push(createdAccount.id);
  });

  it("should create the initial AccountBalance with zero values", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "CURRENT",
        currency: "BDT",
      });

    expect(response.status).toBe(201);

    const accountId =
      response.body.data.account.id;

    createdAccountIds.push(accountId);

    const balance = await prisma.accountBalance.findFirst({
      where: {
        accountId,
        currencyCode: "BDT",
      },
    });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Initial account balance was not created",
      );
    }

    expect(balance.availableBalance.toString()).toBe("0");
    expect(balance.lockedBalance.toString()).toBe("0");
  });

  it("should reject an unauthenticated account creation request", async () => {
    const response = await request(app)
      .post("/api/v1/accounts")
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject non-CUSTOMER users", async () => {
    const admin = await createTestUser(
      "ADMIN",
      "ACTIVE",
    );

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject account creation for an inactive CUSTOMER", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "SUSPENDED",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject a client-supplied balance", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
        balance: 500000,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject an invalid account type", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "INVALID",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject an invalid currency format", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BD",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject unsupported fields", async () => {
    const customer = await createTestUser(
      "CUSTOMER",
      "ACTIVE",
    );

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/accounts")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        accountType: "SAVINGS",
        currency: "BDT",
        ownerId: customer.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject all client-supplied balance fields", async () => {
  const customer = await createTestUser(
    "CUSTOMER",
    "ACTIVE",
  );

  const accessToken = createAccessToken(customer);

  const response = await request(app)
    .post("/api/v1/accounts")
    .set(
      "Authorization",
      `Bearer ${accessToken}`,
    )
    .send({
      accountType: "SAVINGS",
      currency: "BDT",
      balance: 999999,
      availableBalance: 999999,
      lockedBalance: 999999,
    });

  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe(
    "VALIDATION_ERROR",
  );
});
});