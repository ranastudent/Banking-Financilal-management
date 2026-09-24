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
     * Debit sender.
     */
    const senderAfter = await updateBalance(
      tx,
      senderBalance.id,
      amount,
      "debit",
    );

    /*
     * Credit receiver.
     */
    const receiverAfter = await updateBalance(
      tx,
      receiverBalance.id,
      amount,
      "credit",
    );

    // ============================================================
    // TEST-ONLY FAILURE INJECTION
    // Used by 14.6.1.c to verify transaction rollback
    // after debit + credit have already occurred.
    // ============================================================

    if (
      (process.env.NODE_ENV === "test" ||
        process.env.VITEST === "true") &&
      process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION ===
        "true"
    ) {
      throw new AppError(
        "Test failure after balance mutation",
        500,
        ErrorCode.INTERNAL_SERVER_ERROR,
      );
    }

    /*
     * Create transaction.
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
     * Create sender DEBIT and receiver CREDIT
     * ledger entries.
     */
    const ledgerEntries = await Promise.all([
      tx.ledgerEntry.create({
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
      }),

      tx.ledgerEntry.create({
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
      }),
    ]);

    /*
     * Create transaction legs.
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
     * Create audit log inside the same
     * database transaction.
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

      ledgerEntries:
        ledgerEntries.map((entry) => ({
          ...entry,
          amount:
            entry.amount.toString(),
          balanceBefore:
            entry.balanceBefore.toString(),
          balanceAfter:
            entry.balanceAfter.toString(),
        })),

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