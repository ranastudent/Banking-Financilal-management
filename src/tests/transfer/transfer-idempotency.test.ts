import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Fund Transfer - Idempotency", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  const createdIdempotencyRecordIds: string[] = [];

  const TRANSFER_AMOUNT = "1000";
  const INITIAL_SENDER_BALANCE = "10000";
  const INITIAL_RECEIVER_BALANCE = "5000";
  const EXPECTED_SENDER_BALANCE = "9000";
  const EXPECTED_RECEIVER_BALANCE = "6000";

  const FAILURE_STAGE = "BEFORE_IDEMPOTENCY_COMPLETION";

  // ---------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------

  

  // ---------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------

  const createUser = async () => {
    const uniqueId = `${Date.now()}-${Math.random()}`;

    const user = await prisma.user.create({
      data: {
        name: `Transfer Idempotency ${uniqueId}`,
        email: `transfer-idempotency-${uniqueId}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccount = async (userId: string) => {
    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `ACC-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
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
  }) => {
    return generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: "ACTIVE",
    });
  };

  const createIdempotencyKey = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  const createBdtBalance = async (
    accountId: string,
    amount: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance: amount,
        lockedBalance: "0",
      },
    });
  };

  const createTransferFixture = async (prefix: string) => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      INITIAL_SENDER_BALANCE,
    );

    await createBdtBalance(
      receiverAccount.id,
      INITIAL_RECEIVER_BALANCE,
    );

    const accessToken = createAccessToken(sender);
    const idempotencyKey = createIdempotencyKey(prefix);

    const payload = {
      senderAccount: senderAccount.accountNumber,
      receiverAccount: receiverAccount.accountNumber,
      amount: TRANSFER_AMOUNT,
      currency: "BDT",
    };

    return {
      sender,
      receiver,
      senderAccount,
      receiverAccount,
      accessToken,
      idempotencyKey,
      payload,
    };
  };

  const sendTransfer = (
    accessToken: string,
    idempotencyKey: string,
    payload: {
      senderAccount: string;
      receiverAccount: string;
      amount: string;
      currency: string;
    },
  ) => {
    return request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
  };

  const getBdtBalance = async (accountId: string) => {
    return prisma.accountBalance.findUnique({
      where: {
        accountId_currencyCode: {
          accountId,
          currencyCode: "BDT",
        },
      },
    });
  };

  const expectBalances = async (
    senderAccountId: string,
    receiverAccountId: string,
    expectedSender: string,
    expectedReceiver: string,
  ) => {
    const [senderBalance, receiverBalance] = await Promise.all([
      getBdtBalance(senderAccountId),
      getBdtBalance(receiverAccountId),
    ]);

    expect(senderBalance).not.toBeNull();
    expect(receiverBalance).not.toBeNull();

    expect(senderBalance!.availableBalance.toString()).toBe(
      expectedSender,
    );

    expect(receiverBalance!.availableBalance.toString()).toBe(
      expectedReceiver,
    );
  };

  const expectCorrectLedgerEntries = async (
    transactionId: string,
    expectedAmount: string,
  ) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        transactionId,
      },
      select: {
        entryType: true,
        amount: true,
      },
    });

    expect(entries).toHaveLength(2);

    expect(
      entries.map((entry) => ({
        entryType: entry.entryType,
        amount: entry.amount.toString(),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          entryType: "DEBIT",
          amount: expectedAmount,
        },
        {
          entryType: "CREDIT",
          amount: expectedAmount,
        },
      ]),
    );
  };

  const expectCorrectTransactionLegs = async (
    transactionId: string,
    expectedAmount: string,
  ) => {
    const legs = await prisma.transactionLeg.findMany({
      where: {
        transactionId,
      },
      select: {
        entryType: true,
        amount: true,
      },
    });

    expect(legs).toHaveLength(2);

    expect(
      legs.map((leg) => ({
        entryType: leg.entryType,
        amount: leg.amount.toString(),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          entryType: "DEBIT",
          amount: expectedAmount,
        },
        {
          entryType: "CREDIT",
          amount: expectedAmount,
        },
      ]),
    );
  };

  const findAndTrackSingleTransfer = async (
    senderAccountId: string,
    receiverAccountId: string,
  ) => {
    const transactions = await prisma.transaction.findMany({
      where: {
        sourceAccountId: senderAccountId,
        destinationAccountId: receiverAccountId,
        type: "INTERNAL_TRANSFER",
      },
    });

    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    if (!transaction) {
      throw new Error("Expected exactly one transfer transaction");
    }

    createdTransactionIds.push(transaction.id);

    return transaction;
  };

  const expectNoTransfer = async (
    senderAccountId: string,
    receiverAccountId: string,
  ) => {
    const transactions = await prisma.transaction.findMany({
      where: {
        sourceAccountId: senderAccountId,
        destinationAccountId: receiverAccountId,
        type: "INTERNAL_TRANSFER",
      },
    });

    expect(transactions).toHaveLength(0);
  };

  const getIdempotencyRecord = async (
    key: string,
    userId: string,
  ) => {
    return prisma.idempotencyRecord.findUnique({
      where: {
        key_userId: {
          key,
          userId,
        },
      },
    });
  };

  // ---------------------------------------------------------
  // 15.5.1 First request creates a transfer
  // ---------------------------------------------------------

  it("should execute the first request successfully", async () => {
    const fixture = await createTransferFixture("transfer-first");

    const response = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      fixture.payload,
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.transaction.type).toBe(
      "INTERNAL_TRANSFER",
    );

    expect(response.body.data.transaction.status).toBe("COMPLETED");
    expect(response.body.data.transaction.amount).toBe(
      TRANSFER_AMOUNT,
    );

    const transaction = await findAndTrackSingleTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectCorrectLedgerEntries(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectCorrectTransactionLegs(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      EXPECTED_SENDER_BALANCE,
      EXPECTED_RECEIVER_BALANCE,
    );
  });

  // ---------------------------------------------------------
  // 15.5.2 Same key + same request replays the response
  // ---------------------------------------------------------

  it("should recover safely when the transfer commits but the client retries because the response was lost", async () => {
  const fixture = await createTransferFixture(
    "transfer-crash-recovery",
  );

  // First request:
  // The transfer commits successfully.
  // Imagine the client does not receive or retain the response.
  const firstResponse = await sendTransfer(
    fixture.accessToken,
    fixture.idempotencyKey,
    fixture.payload,
  );

  expect(firstResponse.status).toBe(200);

  const originalTransactionId =
    firstResponse.body.data.transaction.id;

  // Confirm that the idempotency record was committed.
  const completedRecord = await getIdempotencyRecord(
    fixture.idempotencyKey,
    fixture.sender.id,
  );

  expect(completedRecord).not.toBeNull();
  expect(completedRecord!.responseStatus).toBe(200);
  expect(completedRecord!.responseBody).not.toBeNull();

  // Second request:
  // Simulate the client retrying because it did not receive
  // the original response.
  const retryResponse = await sendTransfer(
    fixture.accessToken,
    fixture.idempotencyKey,
    fixture.payload,
  );

  expect(retryResponse.status).toBe(200);
  expect(retryResponse.body.success).toBe(true);

  // The retry must return the original transaction.
  expect(
    retryResponse.body.data.transaction.id,
  ).toBe(originalTransactionId);

  // The financial effect must occur exactly once.
  await expectBalances(
    fixture.senderAccount.id,
    fixture.receiverAccount.id,
    EXPECTED_SENDER_BALANCE,
    EXPECTED_RECEIVER_BALANCE,
  );

  // Exactly one transfer must exist.
  const transaction = await findAndTrackSingleTransfer(
    fixture.senderAccount.id,
    fixture.receiverAccount.id,
  );

  expect(transaction.id).toBe(originalTransactionId);

  // The original transfer must have exactly two ledger entries.
  await expectCorrectLedgerEntries(
    transaction.id,
    TRANSFER_AMOUNT,
  );

  // The original transfer must have exactly two transaction legs.
  await expectCorrectTransactionLegs(
    transaction.id,
    TRANSFER_AMOUNT,
  );
});

  // ---------------------------------------------------------
  // 15.5.3 Reusing the same key must not duplicate financial
  //        changes
  // ---------------------------------------------------------

  it("should not duplicate the financial effect when the same key is reused", async () => {
    const fixture = await createTransferFixture(
      "transfer-integrity",
    );

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      INITIAL_SENDER_BALANCE,
      INITIAL_RECEIVER_BALANCE,
    );

    const firstResponse = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      fixture.payload,
    );

    expect(firstResponse.status).toBe(200);

    const secondResponse = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      fixture.payload,
    );

    expect(secondResponse.status).toBe(200);

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      EXPECTED_SENDER_BALANCE,
      EXPECTED_RECEIVER_BALANCE,
    );

    const transaction = await findAndTrackSingleTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectCorrectLedgerEntries(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectCorrectTransactionLegs(
      transaction.id,
      TRANSFER_AMOUNT,
    );
  });

  // ---------------------------------------------------------
  // 15.5.4 Same key + different request must be rejected
  // ---------------------------------------------------------

  it("should reject the same idempotency key when the request payload changes", async () => {
    const fixture = await createTransferFixture(
      "transfer-conflict",
    );

    const firstResponse = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      fixture.payload,
    );

    expect(firstResponse.status).toBe(200);

    const changedPayload = {
      ...fixture.payload,
      amount: "2000",
    };

    const secondResponse = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      changedPayload,
    );

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.success).toBe(false);

    expect(secondResponse.body.error.code).toBe("CONFLICT");

    expect(secondResponse.body.error.message).toBe(
      "Idempotency-Key was already used with a different request",
    );

    // Only the original request should affect balances.
    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      EXPECTED_SENDER_BALANCE,
      EXPECTED_RECEIVER_BALANCE,
    );

    const transaction = await findAndTrackSingleTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectCorrectLedgerEntries(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectCorrectTransactionLegs(
      transaction.id,
      TRANSFER_AMOUNT,
    );
  });

  // ---------------------------------------------------------
  // 15.5.5 Concurrent duplicate requests
  // ---------------------------------------------------------

  it("should prevent concurrent duplicate transfers with the same idempotency key", async () => {
    const fixture = await createTransferFixture(
      "transfer-concurrent",
    );

    const responses = await Promise.all([
      sendTransfer(
        fixture.accessToken,
        fixture.idempotencyKey,
        fixture.payload,
      ),
      sendTransfer(
        fixture.accessToken,
        fixture.idempotencyKey,
        fixture.payload,
      ),
    ]);

    // At least one request must complete successfully.
    expect(
      responses.some((response) => response.status === 200),
    ).toBe(true);

    // Depending on timing, the second request may replay or
    // receive a conflict while the first request is processing.
    expect(
      responses.every(
        (response) =>
          response.status === 200 || response.status === 409,
      ),
    ).toBe(true);

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      EXPECTED_SENDER_BALANCE,
      EXPECTED_RECEIVER_BALANCE,
    );

    const transaction = await findAndTrackSingleTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectCorrectLedgerEntries(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectCorrectTransactionLegs(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    const record = await getIdempotencyRecord(
      fixture.idempotencyKey,
      fixture.sender.id,
    );

    expect(record).not.toBeNull();
    expect(record!.responseStatus).toBe(200);
    expect(record!.responseBody).not.toBeNull();
  });

  // ---------------------------------------------------------
  // 15.5.6 Failure before idempotency completion must roll back
  //        the financial transaction
  // ---------------------------------------------------------

  it("should roll back all financial changes when idempotency completion fails", async () => {
    const fixture = await createTransferFixture(
      "transfer-idempotency-rollback",
    );

    // This hook must be implemented in the transfer service
    // immediately before the idempotency record is completed
    // inside the Prisma transaction.
    vi.stubEnv("TRANSFER_TEST_FAILURE_STAGE", FAILURE_STAGE);

    let response;

    try {
      response = await sendTransfer(
        fixture.accessToken,
        fixture.idempotencyKey,
        fixture.payload,
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(response).toBeDefined();
    expect(response!.status).toBe(500);

    // No transfer must be committed.
    await expectNoTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    // Both balances must remain unchanged.
    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      INITIAL_SENDER_BALANCE,
      INITIAL_RECEIVER_BALANCE,
    );

    // No ledger entries or transaction legs should be committed.
    const transactions = await prisma.transaction.findMany({
      where: {
        sourceAccountId: fixture.senderAccount.id,
        destinationAccountId: fixture.receiverAccount.id,
        type: "INTERNAL_TRANSFER",
      },
      select: {
        id: true,
      },
    });

    expect(transactions).toHaveLength(0);

    // The controller may remove the incomplete idempotency
    // reservation after the failed request. If it retains one,
    // it must not be marked completed.
    const record = await getIdempotencyRecord(
      fixture.idempotencyKey,
      fixture.sender.id,
    );

    if (record) {
      expect(record.responseStatus).toBeNull();
    }
  });

  // ---------------------------------------------------------
  // 15.5.7 Retry after rollback must execute exactly once
  // ---------------------------------------------------------

  it("should allow a safe retry with the same key after a rolled-back transfer", async () => {
    const fixture = await createTransferFixture(
      "transfer-idempotency-retry",
    );

    // First request: inject a failure before idempotency
    // completion. The financial transaction should roll back.
    vi.stubEnv("TRANSFER_TEST_FAILURE_STAGE", FAILURE_STAGE);

    let failedResponse;

    try {
      failedResponse = await sendTransfer(
        fixture.accessToken,
        fixture.idempotencyKey,
        fixture.payload,
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(failedResponse).toBeDefined();
    expect(failedResponse!.status).toBe(500);

    await expectNoTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      INITIAL_SENDER_BALANCE,
      INITIAL_RECEIVER_BALANCE,
    );

    // Second request: same key and same payload, with the
    // injected failure disabled.
    const retryResponse = await sendTransfer(
      fixture.accessToken,
      fixture.idempotencyKey,
      fixture.payload,
    );

    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body.success).toBe(true);

    await expectBalances(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
      EXPECTED_SENDER_BALANCE,
      EXPECTED_RECEIVER_BALANCE,
    );

    // Exactly one transfer should exist after the successful retry.
    const transaction = await findAndTrackSingleTransfer(
      fixture.senderAccount.id,
      fixture.receiverAccount.id,
    );

    await expectCorrectLedgerEntries(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    await expectCorrectTransactionLegs(
      transaction.id,
      TRANSFER_AMOUNT,
    );

    // The retry should leave a completed idempotency record.
    const record = await getIdempotencyRecord(
      fixture.idempotencyKey,
      fixture.sender.id,
    );

    expect(record).not.toBeNull();
    expect(record!.responseStatus).toBe(200);
    expect(record!.responseBody).not.toBeNull();
  });
});