import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

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

type LockedBalance = {
  id: string;
  accountId: string;
  availableBalance: Prisma.Decimal;
  lockedBalance: Prisma.Decimal;
};

/* Performance logging */

const perfLog = (
  message: string,
  metadata?: Record<string, unknown>,
): void => {
  if (process.env.TRANSFER_PERF_DEBUG !== "true") {
    return;
  }

  console.log(
    `[TRANSFER-PERF] ${message}`,
    metadata ? JSON.stringify(metadata) : "",
  );
};

/* Test failure injection */

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
  const isTest =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true";

  if (
    isTest &&
    process.env.TRANSFER_TEST_FAILURE_STAGE === stage
  ) {
    throw new AppError(
      `Test failure at transfer stage: ${stage}`,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }
};

/* Account lock */

const lockAccountByNumber = async (
  tx: Prisma.TransactionClient,
  accountNumber: string,
): Promise<LockedAccount> => {
  const start = performance.now();

  const rows = await tx.$queryRaw<LockedAccount[]>`
    SELECT
      id,
      user_id,
      account_number,
      account_type,
      status
    FROM accounts
    WHERE account_number = ${accountNumber}
    FOR SHARE
  `;

  perfLog("account share lock completed", {
    accountNumber,
    durationMs: Number(
      (performance.now() - start).toFixed(2),
    ),
  });

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

/* Stage 2H-B: single-query balance locking */

const lockBalances = async (
  tx: Prisma.TransactionClient,
  accountIds: string[],
  currencyCode: string,
): Promise<Map<string, LockedBalance>> => {
  const orderedIds = [...accountIds].sort();

  const rows = await tx.$queryRaw<LockedBalance[]>`
    SELECT
      id,
      account_id AS "accountId",
      available_balance AS "availableBalance",
      locked_balance AS "lockedBalance"
    FROM account_balances
    WHERE account_id IN (
      ${Prisma.join(
        orderedIds.map(
          (id) => Prisma.sql`CAST(${id} AS uuid)`,
        ),
      )}
    )
      AND currency_code = ${currencyCode}
    ORDER BY account_id ASC
    FOR UPDATE
  `;

  return new Map(
    rows.map((balance) => [
      balance.accountId,
      balance,
    ]),
  );
};

/* Stage 2H-A: update already-locked balance */

const updateBalance = async (
  tx: Prisma.TransactionClient,
  balance: LockedBalance,
  amount: Prisma.Decimal,
  operation: "debit" | "credit",
): Promise<LockedBalance> => {
  const start = performance.now();

  const updated = await tx.accountBalance.updateMany({
    where: {
      id: balance.id,
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
          ? { decrement: amount }
          : { increment: amount },
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

  const result: LockedBalance = {
    id: balance.id,
    accountId: balance.accountId,
    availableBalance:
      operation === "debit"
        ? balance.availableBalance.sub(amount)
        : balance.availableBalance.add(amount),
    lockedBalance: balance.lockedBalance,
  };

  perfLog(`balance ${operation} completed`, {
    balanceId: balance.id,
    amount: amount.toString(),
    durationMs: Number(
      (performance.now() - start).toFixed(2),
    ),
  });

  return result;
};

/* Main transfer */

export const prepareTransfer = async (
  user: AuthUser,
  input: TransferInput,
) => {
  const amount = new Prisma.Decimal(input.amount);
  const perfTransferId = randomUUID();

  /* Currency validation outside transaction */

  const currencyStart = performance.now();

  const currency = await prisma.currency.findUnique({
    where: { code: input.currency },
    select: {
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
      isActive: true,
    },
  });

  perfLog("currency validation completed", {
    perfTransferId,
    currencyCode: input.currency,
    found: Boolean(currency),
    outsideTransaction: true,
    durationMs: Number(
      (performance.now() - currencyStart).toFixed(2),
    ),
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

  const transactionCallStart = performance.now();

  perfLog("transaction requested", {
    perfTransferId,
    senderAccount: input.senderAccount,
    receiverAccount: input.receiverAccount,
    amount: amount.toString(),
    currency: currency.code,
  });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const callbackStart = performance.now();

        perfLog("transaction callback started", {
          perfTransferId,
          waitBeforeCallbackMs: Number(
            (
              callbackStart -
              transactionCallStart
            ).toFixed(2),
          ),
        });

        /* 1. Lock accounts */

        const accountLockStart = performance.now();

        const orderedAccounts = [
          input.senderAccount,
          input.receiverAccount,
        ].sort();

        const lockedAccounts = await Promise.all(
          orderedAccounts.map((accountNumber) =>
            lockAccountByNumber(
              tx,
              accountNumber,
            ),
          ),
        );

        perfLog(
          "both account share locks completed",
          {
            perfTransferId,
            durationMs: Number(
              (
                performance.now() -
                accountLockStart
              ).toFixed(2),
            ),
          },
        );

        const sender = lockedAccounts.find(
          (account) =>
            account.account_number ===
            input.senderAccount,
        );

        const receiver = lockedAccounts.find(
          (account) =>
            account.account_number ===
            input.receiverAccount,
        );

        if (!sender) {
          throw new AppError(
            "Sender account not found",
            404,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        if (!receiver) {
          throw new AppError(
            "Receiver account not found",
            404,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        if (sender.id === receiver.id) {
          throw new AppError(
            "Sender and receiver accounts must be different",
            400,
            ErrorCode.BAD_REQUEST,
          );
        }

        /* 2. Authorization */

        const authorizationStart =
          performance.now();

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

        perfLog("authorization completed", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              authorizationStart
            ).toFixed(2),
          ),
        });

        /* 3. Account status */

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

        /* 4. Lock both balances in one SQL query */

        const balanceReadStart = performance.now();

        const lockedBalances = await lockBalances(
          tx,
          [sender.id, receiver.id],
          currency.code,
        );

        const senderBalance =
          lockedBalances.get(sender.id) ?? null;

        const receiverBalance =
          lockedBalances.get(receiver.id) ?? null;

        perfLog("both balances locked", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              balanceReadStart
            ).toFixed(2),
          ),
        });

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

        /* 5. Balance check */

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

        /* 6. Debit */

        const debitStart = performance.now();

        const senderAfter = await updateBalance(
          tx,
          senderBalance,
          amount,
          "debit",
        );

        perfLog("sender debit completed", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              debitStart
            ).toFixed(2),
          ),
        });

        throwIfTransferTestFailure(
          "AFTER_SENDER_DEBIT",
        );

        /* 7. Credit */

        const creditStart = performance.now();

        const receiverAfter = await updateBalance(
          tx,
          receiverBalance,
          amount,
          "credit",
        );

        perfLog("receiver credit completed", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              creditStart
            ).toFixed(2),
          ),
        });

        throwIfTransferTestFailure(
          "AFTER_RECEIVER_CREDIT",
        );

        /* 8. Transaction record */

        const transactionCreateStart =
          performance.now();

        const transaction =
          await tx.transaction.create({
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
                operation:
                  "INTERNAL_FUND_TRANSFER",
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

        perfLog(
          "transaction record created",
          {
            perfTransferId,
            transactionId: transaction.id,
            durationMs: Number(
              (
                performance.now() -
                transactionCreateStart
              ).toFixed(2),
            ),
          },
        );

        throwIfTransferTestFailure(
          "AFTER_TRANSACTION_CREATION",
        );

        /* 9. Ledger entries */

        const senderLedgerStart =
          performance.now();

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

        perfLog(
          "sender ledger entry created",
          {
            perfTransferId,
            durationMs: Number(
              (
                performance.now() -
                senderLedgerStart
              ).toFixed(2),
            ),
          },
        );

        throwIfTransferTestFailure(
          "AFTER_FIRST_LEDGER_ENTRY",
        );

        const receiverLedgerStart =
          performance.now();

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

        perfLog(
          "receiver ledger entry created",
          {
            perfTransferId,
            durationMs: Number(
              (
                performance.now() -
                receiverLedgerStart
              ).toFixed(2),
            ),
          },
        );

        throwIfTransferTestFailure(
          "AFTER_SECOND_LEDGER_ENTRY",
        );

        /* 10. Transaction legs */

        const transactionLegStart =
          performance.now();

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

        perfLog(
          "transaction legs created",
          {
            perfTransferId,
            durationMs: Number(
              (
                performance.now() -
                transactionLegStart
              ).toFixed(2),
            ),
          },
        );

        /* 11. Audit */

        const auditStart = performance.now();

        const auditLog =
          await tx.auditLog.create({
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
                operation:
                  "INTERNAL_FUND_TRANSFER",
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

        perfLog("audit log created", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              auditStart
            ).toFixed(2),
          ),
        });

        throwIfTransferTestFailure(
          "AFTER_AUDIT_CREATION",
        );

        perfLog(
          "transaction callback completed",
          {
            perfTransferId,
            callbackDurationMs: Number(
              (
                performance.now() -
                callbackStart
              ).toFixed(2),
            ),
          },
        );

        return {
          transaction: {
            ...transaction,
            amount:
              transaction.amount.toString(),
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
      },
    );

    perfLog(
      "transaction completed successfully",
      {
        perfTransferId,
        totalTransactionCallDurationMs:
          Number(
            (
              performance.now() -
              transactionCallStart
            ).toFixed(2),
          ),
      },
    );

    return result;
  } catch (error) {
    perfLog("transaction failed", {
      perfTransferId,
      totalTransactionCallDurationMs:
        Number(
          (
            performance.now() -
            transactionCallStart
          ).toFixed(2),
        ),
      errorName:
        error instanceof Error
          ? error.name
          : "UnknownError",
      errorMessage:
        error instanceof Error
          ? error.message
          : String(error),
    });

    throw error;
  }
};

/* Legacy authorization-only operation */

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