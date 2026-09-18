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
  getDepositAuditLogs,
  getDepositBalance,
  getDepositIdempotencyRecord,
  getDepositLedgerEntries,
  getDepositTransactions,
} from "./deposit-test.helpers";

afterEach(async () => {
  await cleanupDepositTestData();
});

describe("12.11.4 Deposit Validation + Idempotency Security", () => {
  it("should reject a request without Idempotency-Key", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(0);
  });

  it("should reject an empty Idempotency-Key", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", "   ")
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should reject an amount of zero", async () => {
    const user = await createDepositTestUser();
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
        amount: "0",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should reject a negative amount", async () => {
    const user = await createDepositTestUser();
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
        amount: "-100",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should reject an amount with more than 8 decimal places", async () => {
    const user = await createDepositTestUser();
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
        amount: "10.123456789",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should reject an invalid currency format", async () => {
    const user = await createDepositTestUser();
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
        currency: "BD",
      });

    expect(response.status).toBe(400);
  });

  it("should reject unknown fields in the request body", async () => {
    const user = await createDepositTestUser();
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
        balance: "999999999",
      });

    expect(response.status).toBe(400);
  });

  it("should return the original result for a repeated identical request", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const key = depositKey("replay");

    const firstResponse = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(secondResponse.status).toBe(200);

    expect(secondResponse.body.success).toBe(true);

    expect(secondResponse.body.data).toEqual(
      firstResponse.body.data,
    );

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10500",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(1);

    const ledgerEntries =
      await getDepositLedgerEntries(account.id);

    expect(ledgerEntries).toHaveLength(1);

    const auditLogs =
      await getDepositAuditLogs(user.id);

    expect(auditLogs).toHaveLength(1);
  });

  it("should reject reuse of a key with a different request", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const key = depositKey("different-request");

    const firstResponse = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "1000.00",
        currency: "BDT",
      });

    expect(secondResponse.status).toBe(409);

    const balance = await getDepositBalance(account.id);

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error("Expected account balance was not found");
    }

    expect(balance.availableBalance.toString()).toBe(
      "10500",
    );

    const transactions =
      await getDepositTransactions(account.id);

    expect(transactions).toHaveLength(1);

    const record =
      await getDepositIdempotencyRecord(
        user.id,
        key,
      );

    expect(record).not.toBeNull();

    if (!record) {
      throw new Error(
        "Expected idempotency record was not found",
      );
    }

    expect(record.responseStatus).toBe(200);
  });

  it("should allow the same Idempotency-Key for different users", async () => {
    const user1 = await createDepositTestUser();
    const user2 = await createDepositTestUser();

    const account1 =
      await createDepositTestAccount(user1.id);

    const account2 =
      await createDepositTestAccount(user2.id);

    const token1 =
      createDepositAccessToken(user1);

    const token2 =
      createDepositAccessToken(user2);

    const key = "same-key-different-users";

    const response1 = await request(app)
      .post(
        `/api/v1/accounts/${account1.id}/deposits`,
      )
      .set("Authorization", `Bearer ${token1}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "300.00",
        currency: "BDT",
      });

    const response2 = await request(app)
      .post(
        `/api/v1/accounts/${account2.id}/deposits`,
      )
      .set("Authorization", `Bearer ${token2}`)
      .set("Idempotency-Key", key)
      .send({
        amount: "700.00",
        currency: "BDT",
      });

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    const balance1 =
      await getDepositBalance(account1.id);

    const balance2 =
      await getDepositBalance(account2.id);

    expect(balance1).not.toBeNull();
    expect(balance2).not.toBeNull();

    if (!balance1 || !balance2) {
      throw new Error(
        "Expected account balances were not found",
      );
    }

    expect(balance1.availableBalance.toString()).toBe(
      "10300",
    );

    expect(balance2.availableBalance.toString()).toBe(
      "10700",
    );

    const record1 =
      await getDepositIdempotencyRecord(
        user1.id,
        key,
      );

    const record2 =
      await getDepositIdempotencyRecord(
        user2.id,
        key,
      );

    expect(record1).not.toBeNull();
    expect(record2).not.toBeNull();
  });

  it("should reject an Idempotency-Key longer than 128 characters", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const longKey = "a".repeat(129);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", longKey)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });

  it("should reject invalid characters in Idempotency-Key", async () => {
    const user = await createDepositTestUser();
    const account =
      await createDepositTestAccount(user.id);

    const accessToken =
      createDepositAccessToken(user);

    const response = await request(app)
      .post(
        `/api/v1/accounts/${account.id}/deposits`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", "bad key")
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
  });
});