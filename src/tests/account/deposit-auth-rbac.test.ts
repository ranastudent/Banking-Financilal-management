import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import {
  createDepositAccessToken,
  createDepositTestAccount,
  createDepositTestUser,
  cleanupDepositTestData,
  depositKey,
  getDepositBalance,
  getDepositTransactions,
} from "./deposit-test.helpers";

afterEach(async () => {
  await cleanupDepositTestData();
});

describe("12.11.2 Deposit Authentication + RBAC Security", () => {
  it("should reject a deposit request without authentication", async () => {
    const user = await createDepositTestUser();
    const account = await createDepositTestAccount(user.id);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(401);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10000",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);
  });

  it("should reject an invalid access token", async () => {
    const user = await createDepositTestUser();
    const account = await createDepositTestAccount(user.id);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", "Bearer invalid-token")
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(401);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);
  });

  it("should allow a CUSTOMER to deposit into their own account", async () => {
    const user = await createDepositTestUser(
      "CUSTOMER",
    );
    const account = await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should allow an ADMIN to deposit into any account", async () => {
    const owner = await createDepositTestUser(
      "CUSTOMER",
    );

    const admin = await createDepositTestUser("ADMIN");

    const account = await createDepositTestAccount(
      owner.id,
    );

    const accessToken =
      createDepositAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "750.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10750",
    );
  });

  it("should reject a SUPPORT user", async () => {
    const owner = await createDepositTestUser();

    const support =
      await createDepositTestUser("SUPPORT");

    const account = await createDepositTestAccount(
      owner.id,
    );

    const accessToken =
      createDepositAccessToken(support);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
  });

  it("should reject an AUDITOR user", async () => {
    const owner = await createDepositTestUser();

    const auditor =
      await createDepositTestUser("AUDITOR");

    const account = await createDepositTestAccount(
      owner.id,
    );

    const accessToken =
      createDepositAccessToken(auditor);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
  });

  it("should not create a deposit for a forbidden role", async () => {
    const owner = await createDepositTestUser();

    const support =
      await createDepositTestUser("SUPPORT");

    const account = await createDepositTestAccount(
      owner.id,
    );

    const accessToken =
      createDepositAccessToken(support);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "1000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10000",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);
  });
});