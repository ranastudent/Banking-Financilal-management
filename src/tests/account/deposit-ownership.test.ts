import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import  app  from "../../app";

import {
  cleanupDepositTestData,
  createDepositAccessToken,
  createDepositTestAccount,
  createDepositTestUser,
  depositKey,
  getDepositBalance,
  getDepositIdempotencyRecord,
  getDepositTransactions,
} from "./deposit-test.helpers";

afterEach(async () => {
  await cleanupDepositTestData();
});

describe("12.11.3 Deposit Ownership Security", () => {
  it("should allow a CUSTOMER to deposit into their own account", async () => {
    const user = await createDepositTestUser(
      "CUSTOMER",
    );

    const account =
      await createDepositTestAccount(user.id);

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
    expect(response.body.data.accountId).toBe(
      account.id,
    );
  });

  it("should reject a CUSTOMER depositing into another customer's account", async () => {
    const owner = await createDepositTestUser(
      "CUSTOMER",
    );

    const attacker = await createDepositTestUser(
      "CUSTOMER",
    );

    const account =
      await createDepositTestAccount(owner.id);

    const accessToken =
      createDepositAccessToken(attacker);

    const key = depositKey(
      "forbidden-ownership",
    );

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "500.00",
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

    const idempotencyRecord =
      await getDepositIdempotencyRecord(
        attacker.id,
        key,
      );

    expect(idempotencyRecord).toBeNull();
  });

  it("should return 404 for a nonexistent account", async () => {
    const user = await createDepositTestUser();

    const accessToken =
      createDepositAccessToken(user);

    const nonexistentAccountId =
      "11111111-1111-4111-8111-111111111111";

    const response = await request(app)
      .post(
        `/api/v1/accounts/${nonexistentAccountId}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(404);
  });

  it("should reject an invalid account ID before database mutation", async () => {
    const user = await createDepositTestUser();

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post("/api/v1/accounts/not-a-uuid/deposits")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should allow ADMIN to bypass customer ownership restriction", async () => {
    const owner = await createDepositTestUser(
      "CUSTOMER",
    );

    const admin = await createDepositTestUser("ADMIN");

    const account =
      await createDepositTestAccount(owner.id);

    const accessToken =
      createDepositAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", depositKey())
      .send({
        amount: "250.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10250",
    );
  });
});