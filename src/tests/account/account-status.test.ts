import request from "supertest";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import {
  AccountStatus,
  AccountType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Account Status Management", () => {
  let customerId: string;
  let otherCustomerId: string;

  let customerToken: string;

  let accountId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Account Status Test User",
        email: `account-status-${Date.now()}@example.com`,
        passwordHash: "hashed-password",
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    const otherCustomer = await prisma.user.create({
      data: {
        name: "Other Account Status Test User",
        email: `account-status-other-${Date.now()}@example.com`,
        passwordHash: "hashed-password",
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
    });

    customerId = customer.id;
    otherCustomerId = otherCustomer.id;

    customerToken = generateAccessToken({
      id: customer.id,
      email: customer.email,
      role: customer.role,
      status: customer.status,
    });

    const account = await prisma.account.create({
      data: {
        userId: customer.id,
        accountNumber: `10${Date.now()}${Math.floor(Math.random() * 1000)}`,
        accountType: AccountType.SAVINGS,
        status: AccountStatus.ACTIVE,
        balances: {
          create: {
            currencyCode: "BDT",
            availableBalance: "10000.00",
            lockedBalance: "500.00",
          },
        },
      },
    });

    const otherAccount = await prisma.account.create({
      data: {
        userId: otherCustomer.id,
        accountNumber: `20${Date.now()}${Math.floor(Math.random() * 1000)}`,
        accountType: AccountType.SAVINGS,
        status: AccountStatus.ACTIVE,
        balances: {
          create: {
            currencyCode: "BDT",
            availableBalance: "5000.00",
            lockedBalance: "200.00",
          },
        },
      },
    });

    accountId = account.id;
    otherAccountId = otherAccount.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: customerId },
          { userId: otherCustomerId },
          { entityId: accountId },
          { entityId: otherAccountId },
        ],
      },
    });

    await prisma.accountBalance.deleteMany({
      where: {
        OR: [
          { accountId },
          { accountId: otherAccountId },
        ],
      },
    });

    await prisma.account.deleteMany({
      where: {
        OR: [
          { id: accountId },
          { id: otherAccountId },
        ],
      },
    });

    await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { userId: customerId },
          { userId: otherCustomerId },
        ],
      },
    });

    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: customerId },
          { id: otherCustomerId },
        ],
      },
    });

    await prisma.$disconnect();
  });

  it("should change ACTIVE account to FROZEN", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "FROZEN" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.account.status).toBe("FROZEN");

    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    expect(account?.status).toBe(AccountStatus.FROZEN);
  });

  it("should change FROZEN account back to ACTIVE", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.FROZEN,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "ACTIVE" });

    expect(response.status).toBe(200);
    expect(response.body.data.account.status).toBe("ACTIVE");
  });

  it("should change ACTIVE account to CLOSED", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "CLOSED" });

    expect(response.status).toBe(200);
    expect(response.body.data.account.status).toBe("CLOSED");
  });

  it("should change FROZEN account to CLOSED", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.FROZEN,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "CLOSED" });

    expect(response.status).toBe(200);
    expect(response.body.data.account.status).toBe("CLOSED");
  });

  it("should reject modification of a CLOSED account", async () => {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        status: AccountStatus.CLOSED,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "ACTIVE" });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should reject modification of another customer's account", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${otherAccountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "FROZEN" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("should reject unauthenticated status update", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .send({ status: "FROZEN" });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("should reject non-CUSTOMER role", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Account Status Test Admin",
        email: `account-status-admin-${Date.now()}@example.com`,
        passwordHash: "hashed-password",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    const adminToken = generateAccessToken({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    });

    try {
      const response = await request(app)
        .patch(`/api/v1/accounts/${accountId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "FROZEN" });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    } finally {
      await prisma.user.delete({
        where: {
          id: admin.id,
        },
      });
    }
  });

  it("should reject invalid account status", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "INVALID_STATUS" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject unsupported fields", async () => {
    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        status: "FROZEN",
        balance: 999999,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should not change account balance when status changes", async () => {
    const before = await prisma.accountBalance.findFirst({
      where: {
        accountId,
        currencyCode: "BDT",
      },
    });

    expect(before).not.toBeNull();

    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "FROZEN" });

    expect(response.status).toBe(200);

    const after = await prisma.accountBalance.findFirst({
      where: {
        accountId,
        currencyCode: "BDT",
      },
    });

    expect(after).not.toBeNull();

    expect(after?.availableBalance.toString()).toBe(
      before?.availableBalance.toString(),
    );

    expect(after?.lockedBalance.toString()).toBe(
      before?.lockedBalance.toString(),
    );
  });

  it("should create an audit log for status change", async () => {
    await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "FROZEN" })
      .expect(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        userId: customerId,
        action: "ACCOUNT_STATUS_CHANGED",
        entityType: "ACCOUNT",
        entityId: accountId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toEqual({
      previousStatus: "ACTIVE",
      newStatus: "FROZEN",
    });
  });

  it("should allow the same status without creating a new status change", async () => {
    const beforeCount = await prisma.auditLog.count({
      where: {
        userId: customerId,
        action: "ACCOUNT_STATUS_CHANGED",
        entityId: accountId,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/accounts/${accountId}/status`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ status: "ACTIVE" });

    expect(response.status).toBe(200);
    expect(response.body.data.account.status).toBe("ACTIVE");

    const afterCount = await prisma.auditLog.count({
      where: {
        userId: customerId,
        action: "ACCOUNT_STATUS_CHANGED",
        entityId: accountId,
      },
    });

    expect(afterCount).toBe(beforeCount);
  });
});