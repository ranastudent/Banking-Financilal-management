import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { TransferInput } from "../schemas/transfer.schema";
import { getTransferAuthorizedAccounts } from "../policies/transfer.policy";

type LockedAccount = {
  id: string;
  user_id: string;
  account_number: string;
  account_type: string;
  status: string;
};

/*
 * ============================================================
 * TEST-ONLY FAILURE INJECTION
 * ============================================================
 *
 * These stages are used by Phase 14.13 to verify that the
 * complete database transaction rolls back when a failure
 * occurs after different mutations.
 *
 * IMPORTANT:
 * This mechanism is active ONLY when NODE_ENV is "test"
 * or when Vitest is running.
 *
 * Production behavior is unchanged.
 * ============================================================
 */

type TransferFailureStage =
  | "AFTER_SENDER_DEBIT"
  | "AFTER_RECEIVER_CREDIT"
  | "AFTER_TRANSACTION_CREATION"
  | "AFTER_FIRST_LEDGER_ENTRY"
  | "AFTER_SECOND_LEDGER_ENTRY"
  | "AFTER_AUDIT_CREATION";

const throwIfTransferTestFailure = (
  stage: TransferFailureStage,
): void => {
  /*
   * Never inject failures outside the test environment.
   */
  const isTestEnvironment =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true";

  if (!isTestEnvironment) {
    return;
  }

  /*
   * Read the requested failure stage.
   */
  const configuredStage =
    process.env.TRANSFER_TEST_FAILURE_STAGE;

  /*
   * Only throw when the current execution point
   * matches the requested test failure stage.
   */
  if (configuredStage === stage) {
    throw new AppError(
      `Test failure at transfer stage: ${stage}`,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }
};

const lockAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<LockedAccount> => {
  const rows = await tx.$queryRaw<LockedAccount[]>`
    SELECT
      id,
      user_id,
      account_number,
      account_type,
      status
    FROM accounts
    WHERE id = CAST(${accountId} AS uuid)
    FOR UPDATE
  `;

  const account = rows[0];

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account;
};

const getAccountId = async (
  tx: Prisma.TransactionClient,
  accountNumber: string,
): Promise<string> => {
  const account = await tx.account.findUnique({
    where: {
      accountNumber,
    },
    select: {
      id: true,
    },
  });

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account.id;
};

const getBalance = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  currencyCode: string,
) => {
  return tx.accountBalance.findUnique({
    where: {
      accountId_currencyCode: {
        accountId,
        currencyCode,
      },
    },
    select: {
      id: true,
      availableBalance: true,
      lockedBalance: true,
    },
  });
};

const validateCurrency = async (
  tx: Prisma.TransactionClient,
  currencyCode: string,
) => {
  const currency = await tx.currency.findUnique({
    where: {
      code: currencyCode,
    },
    select: {
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
      isActive: true,
    },
  });

  if (!currency) {
    throw new AppError(
      "Currency not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (!currency.isActive) {
    throw new AppError(
      "Currency is inactive",
      409,
      ErrorCode.CONFLICT,
    );
  }

  return currency;
};

const updateBalance = async (
  tx: Prisma.TransactionClient,
  balanceId: string,
  amount: Prisma.Decimal,
  operation: "debit" | "credit",
) => {
  const updated = await tx.accountBalance.updateMany({
    where: {
      id: balanceId,
      ...(operation === "debit"
        ? {
            availableBalance: {
              gte: amount,
            },
          }
        : {}),
    },
    data: {
      availableBalance:
        operation === "debit"
          ? {
              decrement: amount,
            }
          : {
              increment: amount,
            },
    },
  });

  if (updated.count !== 1) {
    throw new AppError(
      operation === "debit"
        ? "Insufficient balance"
        : "Receiver balance could not be updated",
      409,
      operation === "debit"
        ? ErrorCode.INSUFFICIENT_BALANCE
        : ErrorCode.CONFLICT,
    );
  }

  const balance = await tx.accountBalance.findUnique({
    where: {
      id: balanceId,
    },
    select: {
      id: true,
      availableBalance: true,
      lockedBalance: true,
    },
  });

  if (!balance) {
    throw new AppError(
      "Balance record not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return balance;
};

export const prepareTransfer = async (
  user: AuthUser,
  input: TransferInput,
) => {
  const amount = new Prisma.Decimal(
    input.amount,
  );

  return prisma.$transaction(async (tx) => {
    /*
     * Resolve account numbers to account IDs.
     */
    const senderId = await getAccountId(
      tx,
      input.senderAccount,
    );

    const receiverId = await getAccountId(
      tx,
      input.receiverAccount,
    );

    /*
     * Sender and receiver cannot be the same account.
     */
    if (senderId === receiverId) {
      throw new AppError(
        "Sender and receiver accounts must be different",
        400,
        ErrorCode.BAD_REQUEST,
      );
    }

    /*
     * Lock both accounts in deterministic order.
     *
     * This reduces deadlock risk when:
     * A -> B
     * B -> A
     */
    const orderedIds = [
      senderId,
      receiverId,
    ].sort();

    const lockedAccounts = await Promise.all(
      orderedIds.map((id) =>
        lockAccount(tx, id),
      ),
    );

    const sender = lockedAccounts.find(
      (account) => account.id === senderId,
    );

    const receiver = lockedAccounts.find(
      (account) => account.id === receiverId,
    );

    if (!sender || !receiver) {
      throw new AppError(
        "Transfer accounts could not be locked",
        500,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    /*
     * Authorization.
     */
    if (
      user.role === "CUSTOMER" &&
      sender.user_id !== user.id
    ) {
      throw new AppError(
        "You do not have permission to transfer from this account",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    if (
      user.role !== "CUSTOMER" &&
      user.role !== "ADMIN"
    ) {
      throw new AppError(
        "You do not have permission to perform a fund transfer",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    /*
     * Both accounts must be active.
     */
    if (sender.status !== "ACTIVE") {
      throw new AppError(
        "Sender account is not active",
        409,
        ErrorCode.CONFLICT,
      );
    }

    if (receiver.status !== "ACTIVE") {
      throw new AppError(
        "Receiver account is not active",
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * Phase 14:
     * Same-currency transfer only.
     */
    const currency = await validateCurrency(
      tx,
      input.currency,
    );

    /*
     * Get sender and receiver balance
     * for the requested currency.
     */
    const senderBalance = await getBalance(
      tx,
      sender.id,
      currency.code,
    );

    const receiverBalance = await getBalance(
      tx,
      receiver.id,
      currency.code,
    );

    if (!senderBalance) {
      throw new AppError(
        `Sender does not have a ${currency.code} balance`,
        409,
        ErrorCode.CONFLICT,
      );
    }

    if (!receiverBalance) {
      throw new AppError(
        `Receiver does not have a ${currency.code} balance`,
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * Check sender balance.
     */
    if (
      senderBalance.availableBalance.lt(
        amount,
      )
    ) {
      throw new AppError(
        "Insufficient balance",
        409,
        ErrorCode.INSUFFICIENT_BALANCE,
      );
    }

    /*
     * ========================================================
     * 1. Debit sender.
     * ========================================================
     */
    const senderAfter = await updateBalance(
      tx,
      senderBalance.id,
      amount,
      "debit",
    );

    /*
     * 14.13.1
     *
     * Deliberately fail immediately after sender debit.
     *
     * Expected:
     * - sender balance rolls back
     * - receiver remains unchanged
     * - no transaction
     * - no ledger
     * - no transaction legs
     * - no audit log
     */
    throwIfTransferTestFailure(
      "AFTER_SENDER_DEBIT",
    );

    /*
     * ========================================================
     * 2. Credit receiver.
     * ========================================================
     */
    const receiverAfter = await updateBalance(
      tx,
      receiverBalance.id,
      amount,
      "credit",
    );

    /*
     * 14.13.2
     *
     * Deliberately fail after both balance mutations.
     */
    throwIfTransferTestFailure(
      "AFTER_RECEIVER_CREDIT",
    );

    /*
     * ========================================================
     * 3. Create transaction.
     * ========================================================
     */
    const transaction = await tx.transaction.create({
      data: {
        reference: `TRF-${randomUUID()}`,
        type: "INTERNAL_TRANSFER",
        status: "COMPLETED",
        amount,
        currencyCode: currency.code,
        sourceAccountId: sender.id,
        destinationAccountId: receiver.id,
        provider: "INTERNAL",
        metadata: {
          operation: "INTERNAL_FUND_TRANSFER",
        },
      },
      select: {
        id: true,
        reference: true,
        type: true,
        status: true,
        amount: true,
        currencyCode: true,
        sourceAccountId: true,
        destinationAccountId: true,
        provider: true,
        createdAt: true,
      },
    });

    /*
     * 14.13.3
     *
     * Deliberately fail after transaction creation.
     */
    throwIfTransferTestFailure(
      "AFTER_TRANSACTION_CREATION",
    );

    /*
     * ========================================================
     * 4. Create sender DEBIT ledger entry.
     * ========================================================
     *
     * IMPORTANT:
     * These are intentionally sequential rather than Promise.all()
     * because Phase 14.13 needs a failure point after the first
     * ledger entry and another after the second ledger entry.
     */
    const senderLedgerEntry =
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: sender.id,
          currencyCode: currency.code,
          entryType: "DEBIT",
          amount,
          balanceBefore:
            senderBalance.availableBalance,
          balanceAfter:
            senderAfter.availableBalance,
        },
        select: {
          id: true,
          accountId: true,
          entryType: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          createdAt: true,
        },
      });

    /*
     * 14.13.4
     *
     * Deliberately fail after the first ledger entry.
     */
    throwIfTransferTestFailure(
      "AFTER_FIRST_LEDGER_ENTRY",
    );

    /*
     * ========================================================
     * 5. Create receiver CREDIT ledger entry.
     * ========================================================
     */
    const receiverLedgerEntry =
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: receiver.id,
          currencyCode: currency.code,
          entryType: "CREDIT",
          amount,
          balanceBefore:
            receiverBalance.availableBalance,
          balanceAfter:
            receiverAfter.availableBalance,
        },
        select: {
          id: true,
          accountId: true,
          entryType: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          createdAt: true,
        },
      });

    /*
     * 14.13.5
     *
     * Deliberately fail after the second ledger entry.
     */
    throwIfTransferTestFailure(
      "AFTER_SECOND_LEDGER_ENTRY",
    );

    /*
     * ========================================================
     * 6. Create transaction legs.
     * ========================================================
     */
    await tx.transactionLeg.createMany({
      data: [
        {
          transactionId: transaction.id,
          accountId: sender.id,
          currencyCode: currency.code,
          entryType: "DEBIT",
          amount,
        },
        {
          transactionId: transaction.id,
          accountId: receiver.id,
          currencyCode: currency.code,
          entryType: "CREDIT",
          amount,
        },
      ],
    });

    /*
     * ========================================================
     * 7. Create audit log.
     * ========================================================
     *
     * The audit log is intentionally created using the same
     * Prisma transaction client.
     */
    const auditLog = await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "TRANSFER_CREATED",
        entityType: "TRANSACTION",
        entityId: transaction.id,
        description:
          `Fund transfer ${transaction.reference} created from ` +
          `${sender.account_number} to ` +
          `${receiver.account_number}`,
        metadata: {
          operation: "INTERNAL_FUND_TRANSFER",
          senderAccount:
            sender.account_number,
          receiverAccount:
            receiver.account_number,
          amount: amount.toString(),
          currencyCode: currency.code,
          userRole: user.role,
        },
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    });

    /*
     * 14.13.6
     *
     * Deliberately fail AFTER the audit record exists.
     *
     * Because this audit record belongs to the same
     * prisma.$transaction(), it must also be rolled back.
     */
    throwIfTransferTestFailure(
      "AFTER_AUDIT_CREATION",
    );

    return {
      transaction: {
        ...transaction,
        amount: transaction.amount.toString(),
      },

      senderAccount:
        sender.account_number,

      receiverAccount:
        receiver.account_number,

      amount: amount.toString(),

      currency: currency.code,

      balance: {
        senderBefore:
          senderBalance.availableBalance.toString(),

        senderAfter:
          senderAfter.availableBalance.toString(),

        receiverBefore:
          receiverBalance.availableBalance.toString(),

        receiverAfter:
          receiverAfter.availableBalance.toString(),
      },

      ledgerEntries: [
        {
          ...senderLedgerEntry,
          amount:
            senderLedgerEntry.amount.toString(),
          balanceBefore:
            senderLedgerEntry.balanceBefore.toString(),
          balanceAfter:
            senderLedgerEntry.balanceAfter.toString(),
        },
        {
          ...receiverLedgerEntry,
          amount:
            receiverLedgerEntry.amount.toString(),
          balanceBefore:
            receiverLedgerEntry.balanceBefore.toString(),
          balanceAfter:
            receiverLedgerEntry.balanceAfter.toString(),
        },
      ],

      auditLog,
    };
  });
};

/*
 * Legacy authorization-only operation.
 *
 * Kept for existing authorization regression tests.
 */
export const authorizeTransfer = async (
  sourceAccountId: string,
  destinationAccountId: string,
  userId: string,
  userRole: string,
) => {
  return getTransferAuthorizedAccounts(
    sourceAccountId,
    destinationAccountId,
    userId,
    userRole,
  );
};