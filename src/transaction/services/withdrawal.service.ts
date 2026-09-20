import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { WithdrawalInput } from "../../account/schemas/withdrawal.schema";
import type { AuthUser } from "../../types/auth";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LockedAccountRow = {
  id: string;
  user_id: string;
  account_number: string;
  account_type: string;
  status: string;
};

const lockWithdrawalAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<LockedAccountRow> => {
  const accounts = await tx.$queryRaw<
    LockedAccountRow[]
  >`
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

  const account = accounts[0];

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return account;
};

const validateWithdrawalCurrency = async (
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

/*
 * 13.7
 *
 * Lookup the balance for the exact currency requested
 * by the withdrawal.
 */
const getWithdrawalBalance = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  currencyCode: string,
) => {
  const balance =
    await tx.accountBalance.findUnique({
      where: {
        accountId_currencyCode: {
          accountId,
          currencyCode,
        },
      },
      select: {
        id: true,
        currencyCode: true,
        availableBalance: true,
        lockedBalance: true,
      },
    });

  if (!balance) {
    return {
      id: null,
      currencyCode,
      availableBalance: new Prisma.Decimal(0),
      lockedBalance: new Prisma.Decimal(0),
    };
  }

  return balance;
};

/*
 * 13.8
 *
 * Only availableBalance can be used for a withdrawal.
 */
const ensureSufficientWithdrawalBalance = (
  availableBalance: Prisma.Decimal,
  withdrawalAmount: Prisma.Decimal,
): void => {
  if (availableBalance.lt(withdrawalAmount)) {
    throw new AppError(
      "Insufficient balance",
      409,
      ErrorCode.INSUFFICIENT_BALANCE,
    );
  }
};

/*
 * 13.9
 *
 * Maximum amount allowed for one withdrawal.
 */
const ensureWithdrawalTransactionLimit = (
  withdrawalAmount: Prisma.Decimal,
): void => {
  const maximumAmount = new Prisma.Decimal(
    env.withdrawal.maxAmount,
  );

  if (withdrawalAmount.gt(maximumAmount)) {
    throw new AppError(
      "Withdrawal amount exceeds the transaction limit",
      409,
      ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
    );
  }
};

/*
 * 13.10
 *
 * Debit only availableBalance.
 *
 * The database WHERE condition provides an additional
 * defense-in-depth check so the balance can never become
 * negative through this operation.
 */
const debitWithdrawalBalance = async (
  tx: Prisma.TransactionClient,
  balanceId: string | null,
  withdrawalAmount: Prisma.Decimal,
) => {
  if (!balanceId) {
    throw new AppError(
      "Insufficient balance",
      409,
      ErrorCode.INSUFFICIENT_BALANCE,
    );
  }

  const updated =
    await tx.accountBalance.updateMany({
      where: {
        id: balanceId,
        availableBalance: {
          gte: withdrawalAmount,
        },
      },
      data: {
        availableBalance: {
          decrement: withdrawalAmount,
        },
      },
    });

  if (updated.count !== 1) {
    throw new AppError(
      "Insufficient balance",
      409,
      ErrorCode.INSUFFICIENT_BALANCE,
    );
  }

  const balance =
    await tx.accountBalance.findUnique({
      where: {
        id: balanceId,
      },
      select: {
        id: true,
        currencyCode: true,
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

/*
 * 13.11
 *
 * Create the internal financial transaction.
 *
 * For withdrawal:
 * sourceAccountId = withdrawing account
 * destinationAccountId = null
 */
const createWithdrawalTransaction = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  amount: Prisma.Decimal,
  currencyCode: string,
) => {
  return tx.transaction.create({
    data: {
      reference: `WDL-${randomUUID()}`,
      type: "WITHDRAWAL",
      status: "PENDING",
      amount,
      currencyCode,
      sourceAccountId: accountId,
      destinationAccountId: null,
      provider: "INTERNAL",

      metadata: {
        operation: "ACCOUNT_WITHDRAWAL",
        accountId,
        currencyCode,
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
};

/*
 * 13.12
 *
 * Create the debit ledger entry using the exact
 * before/after balance values from this operation.
 */
const createWithdrawalLedgerEntry = async (
  tx: Prisma.TransactionClient,
  transactionId: string,
  accountId: string,
  currencyCode: string,
  amount: Prisma.Decimal,
  balanceBefore: Prisma.Decimal,
  balanceAfter: Prisma.Decimal,
) => {
  return tx.ledgerEntry.create({
    data: {
      transactionId,
      accountId,
      currencyCode,
      entryType: "DEBIT",
      amount,
      balanceBefore,
      balanceAfter,
    },
    select: {
      id: true,
      transactionId: true,
      accountId: true,
      currencyCode: true,
      entryType: true,
      amount: true,
      balanceBefore: true,
      balanceAfter: true,
      createdAt: true,
    },
  });
};

export const prepareWithdrawal = async (
  user: AuthUser,
  accountId: string,
  input: WithdrawalInput,
) => {
  if (!UUID_REGEX.test(accountId)) {
    throw new AppError(
      "Invalid account ID",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  return prisma.$transaction(async (tx) => {
    /*
     * 13.5
     * Lock account before reading financial state.
     */
    const account = await lockWithdrawalAccount(
      tx,
      accountId,
    );

    /*
     * 13.3
     * Authorization / ownership.
     */
    if (
      user.role === "CUSTOMER" &&
      account.user_id !== user.id
    ) {
      throw new AppError(
        "You do not have permission to withdraw from this account",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    if (
      user.role !== "CUSTOMER" &&
      user.role !== "ADMIN"
    ) {
      throw new AppError(
        "You do not have permission to perform a withdrawal",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    /*
     * Account must be active.
     */
    if (account.status !== "ACTIVE") {
      throw new AppError(
        "Withdrawals are not allowed for inactive accounts",
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * 13.6
     * Validate currency.
     */
    const currency =
      await validateWithdrawalCurrency(
        tx,
        input.currency,
      );

    const amount = new Prisma.Decimal(
      input.amount,
    );

    /*
     * 13.7
     * Lookup requested currency balance.
     */
    const balance =
      await getWithdrawalBalance(
        tx,
        account.id,
        currency.code,
      );

    /*
     * 13.8
     * Protect against insufficient balance.
     */
    ensureSufficientWithdrawalBalance(
      balance.availableBalance,
      amount,
    );

    /*
     * 13.9
     * Check per-transaction limit.
     */
    ensureWithdrawalTransactionLimit(
      amount,
    );

    /*
     * 13.10
     * Debit account balance.
     */
    const debitedBalance =
      await debitWithdrawalBalance(
        tx,
        balance.id,
        amount,
      );

    /*
     * 13.11
     * Create the internal withdrawal transaction.
     */
    const transaction =
      await createWithdrawalTransaction(
        tx,
        account.id,
        amount,
        currency.code,
      );

    /*
     * 13.12
     * Create the corresponding DEBIT ledger entry.
     */
    const ledgerEntry =
      await createWithdrawalLedgerEntry(
        tx,
        transaction.id,
        account.id,
        currency.code,
        amount,
        balance.availableBalance,
        debitedBalance.availableBalance,
      );

    return {
      account: {
        id: account.id,
        userId: account.user_id,
        accountNumber:
          account.account_number,
        accountType:
          account.account_type,
        status: account.status,
      },

      currency,

      amount,

      balanceBefore:
        balance.availableBalance.toString(),

      balanceAfter:
        debitedBalance.availableBalance.toString(),

      lockedBalance:
        debitedBalance.lockedBalance.toString(),

      transaction: {
        id: transaction.id,
        reference:
          transaction.reference,
        type: transaction.type,
        status:
          transaction.status,
        amount:
          transaction.amount.toString(),
        currencyCode:
          transaction.currencyCode,
        sourceAccountId:
          transaction.sourceAccountId,
        destinationAccountId:
          transaction.destinationAccountId,
        provider:
          transaction.provider,
        createdAt:
          transaction.createdAt,
      },

      ledgerEntry: {
        id: ledgerEntry.id,
        transactionId:
          ledgerEntry.transactionId,
        accountId:
          ledgerEntry.accountId,
        currencyCode:
          ledgerEntry.currencyCode,
        entryType:
          ledgerEntry.entryType,
        amount:
          ledgerEntry.amount.toString(),
        balanceBefore:
          ledgerEntry.balanceBefore.toString(),
        balanceAfter:
          ledgerEntry.balanceAfter.toString(),
        createdAt:
          ledgerEntry.createdAt,
      },
    };
  });
};

/*
 * Existing authorization-only operation.
 *
 * Kept temporarily until the controller is switched
 * to the complete financial withdrawal flow.
 */
export const authorizeWithdrawal = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  if (!UUID_REGEX.test(accountId)) {
    throw new AppError(
      "Invalid account ID",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const account =
    await prisma.account.findUnique({
      where: {
        id: accountId,
      },
    });

  if (!account) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (
    userRole === "CUSTOMER" &&
    account.userId !== userId
  ) {
    throw new AppError(
      "You do not have permission to withdraw from this account",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (
    userRole !== "CUSTOMER" &&
    userRole !== "ADMIN"
  ) {
    throw new AppError(
      "You do not have permission to perform a withdrawal",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return account;
};