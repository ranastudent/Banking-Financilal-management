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

/*
 * ============================================================
 * PERFORMANCE DEBUGGING
 * ============================================================
 *
 * Enable with:
 *
 * TRANSFER_PERF_DEBUG=true
 *
 * This is diagnostic instrumentation only.
 *
 * It does NOT change:
 * - transaction behavior
 * - locking behavior
 * - financial calculations
 * - rollback behavior
 * - authorization
 *
 * It helps identify where high-concurrency transfers spend time.
 * ============================================================
 */

const isTransferPerfDebugEnabled = (): boolean => {
  return process.env.TRANSFER_PERF_DEBUG === "true";
};

const perfLog = (
  message: string,
  metadata?: Record<string, unknown>,
): void => {
  if (!isTransferPerfDebugEnabled()) {
    return;
  }

  if (metadata) {
    console.log(
      `[TRANSFER-PERF] ${message}`,
      JSON.stringify(metadata),
    );

    return;
  }

  console.log(`[TRANSFER-PERF] ${message}`);
};

/*
 * ============================================================
 * TEST-ONLY FAILURE INJECTION
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
  const isTestEnvironment =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true";

  if (!isTestEnvironment) {
    return;
  }

  const configuredStage =
    process.env.TRANSFER_TEST_FAILURE_STAGE;

  if (configuredStage === stage) {
    throw new AppError(
      `Test failure at transfer stage: ${stage}`,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }
};

/*
 * ============================================================
 * ACCOUNT LOCK
 * ============================================================
 */

const lockAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<LockedAccount> => {
  const lockStart = performance.now();

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

  const lockDuration = performance.now() - lockStart;

  perfLog("account lock completed", {
    accountId,
    durationMs: Number(lockDuration.toFixed(2)),
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

/*
 * ============================================================
 * ACCOUNT RESOLUTION
 * ============================================================
 */

const getAccountId = async (
  tx: Prisma.TransactionClient,
  accountNumber: string,
): Promise<string> => {
  const lookupStart = performance.now();

  const account = await tx.account.findUnique({
    where: {
      accountNumber,
    },
    select: {
      id: true,
    },
  });

  perfLog("account lookup completed", {
    accountNumber,
    durationMs: Number(
      (performance.now() - lookupStart).toFixed(2),
    ),
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

/*
 * ============================================================
 * BALANCE READ
 * ============================================================
 */

const getBalance = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  currencyCode: string,
) => {
  const balanceStart = performance.now();

  const balance = await tx.accountBalance.findUnique({
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

  perfLog("balance lookup completed", {
    accountId,
    currencyCode,
    found: Boolean(balance),
    durationMs: Number(
      (performance.now() - balanceStart).toFixed(2),
    ),
  });

  return balance;
};

/*
 * ============================================================
 * CURRENCY VALIDATION
 * ============================================================
 */

const validateCurrency = async (
  tx: Prisma.TransactionClient,
  currencyCode: string,
) => {
  const currencyStart = performance.now();

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

  perfLog("currency validation completed", {
    currencyCode,
    found: Boolean(currency),
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

  return currency;
};

/*
 * ============================================================
 * BALANCE UPDATE
 * ============================================================
 */

const updateBalance = async (
  tx: Prisma.TransactionClient,
  balanceId: string,
  amount: Prisma.Decimal,
  operation: "debit" | "credit",
) => {
  const updateStart = performance.now();

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

  perfLog(`balance ${operation} completed`, {
    balanceId,
    amount: amount.toString(),
    durationMs: Number(
      (performance.now() - updateStart).toFixed(2),
    ),
  });

  return balance;
};

/*
 * ============================================================
 * MAIN TRANSFER
 * ============================================================
 */

export const prepareTransfer = async (
  user: AuthUser,
  input: TransferInput,
) => {
  const amount = new Prisma.Decimal(input.amount);

  /*
   * Unique ID for correlating performance logs belonging
   * to the same transfer execution.
   */
  const perfTransferId = randomUUID();

  /*
   * IMPORTANT:
   *
   * This timestamp is taken BEFORE calling prisma.$transaction().
   *
   * Therefore:
   *
   * transactionCallDuration =
   *   time spent waiting for Prisma to start/acquire
   *   the interactive transaction
   *
   * This is especially important for diagnosing P2028.
   */
  const transactionCallStart = performance.now();

  perfLog("transaction requested", {
    perfTransferId,
    senderAccount: input.senderAccount,
    receiverAccount: input.receiverAccount,
    amount: amount.toString(),
    currency: input.currency,
  });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * ====================================================
         * TRANSACTION CALLBACK START
         * ====================================================
         *
         * If a P2028 happens before this line, the callback
         * will never execute.
         *
         * That allows us to distinguish transaction-start
         * contention from work inside the transaction.
         */

        const transactionCallbackStart =
          performance.now();

        perfLog("transaction callback started", {
          perfTransferId,
          waitBeforeCallbackMs: Number(
            (
              transactionCallbackStart -
              transactionCallStart
            ).toFixed(2),
          ),
        });

        /*
         * ====================================================
         * 1. RESOLVE ACCOUNTS
         * ====================================================
         */

        const accountResolutionStart =
          performance.now();

        const senderId = await getAccountId(
          tx,
          input.senderAccount,
        );

        const receiverId = await getAccountId(
          tx,
          input.receiverAccount,
        );

        perfLog("account resolution completed", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              accountResolutionStart
            ).toFixed(2),
          ),
        });

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
         * ====================================================
         * 2. LOCK ACCOUNTS
         * ====================================================
         *
         * Locks are acquired in deterministic order.
         *
         * A -> B
         * B -> A
         *
         * both become:
         *
         * smaller UUID -> larger UUID
         *
         * This reduces deadlock risk.
         */

        const accountLockStart =
          performance.now();

        const orderedIds = [
          senderId,
          receiverId,
        ].sort();

        const lockedAccounts = await Promise.all(
          orderedIds.map((id) =>
            lockAccount(tx, id),
          ),
        );

        perfLog("both account locks completed", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              accountLockStart
            ).toFixed(2),
          ),
        });

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
         * ====================================================
         * 3. AUTHORIZATION
         * ====================================================
         */

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

        /*
         * ====================================================
         * 4. ACCOUNT STATUS
         * ====================================================
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
         * ====================================================
         * 5. CURRENCY
         * ====================================================
         */

        const currency = await validateCurrency(
          tx,
          input.currency,
        );

        /*
         * ====================================================
         * 6. BALANCES
         * ====================================================
         */

        const balanceReadStart =
          performance.now();

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

        perfLog("both balances loaded", {
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

        /*
         * ====================================================
         * 7. BALANCE CHECK
         * ====================================================
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
         * ====================================================
         * 8. DEBIT SENDER
         * ====================================================
         */

        const debitStart =
          performance.now();

        const senderAfter = await updateBalance(
          tx,
          senderBalance.id,
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

        /*
         * ====================================================
         * 9. CREDIT RECEIVER
         * ====================================================
         */

        const creditStart =
          performance.now();

        const receiverAfter = await updateBalance(
          tx,
          receiverBalance.id,
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

        /*
         * ====================================================
         * 10. CREATE TRANSACTION
         * ====================================================
         */

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

        perfLog("transaction record created", {
          perfTransferId,
          transactionId: transaction.id,
          durationMs: Number(
            (
              performance.now() -
              transactionCreateStart
            ).toFixed(2),
          ),
        });

        throwIfTransferTestFailure(
          "AFTER_TRANSACTION_CREATION",
        );

        /*
         * ====================================================
         * 11. SENDER LEDGER ENTRY
         * ====================================================
         */

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

        perfLog("sender ledger entry created", {
          perfTransferId,
          durationMs: Number(
            (
              performance.now() -
              senderLedgerStart
            ).toFixed(2),
          ),
        });

        throwIfTransferTestFailure(
          "AFTER_FIRST_LEDGER_ENTRY",
        );

        /*
         * ====================================================
         * 12. RECEIVER LEDGER ENTRY
         * ====================================================
         */

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

        /*
         * ====================================================
         * 13. TRANSACTION LEGS
         * ====================================================
         */

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

        /*
         * ====================================================
         * 14. AUDIT LOG
         * ====================================================
         */

        const auditStart =
          performance.now();

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

        /*
         * ====================================================
         * TRANSACTION CALLBACK COMPLETED
         * ====================================================
         */

        perfLog(
          "transaction callback completed",
          {
            perfTransferId,
            callbackDurationMs: Number(
              (
                performance.now() -
                transactionCallbackStart
              ).toFixed(2),
            ),
          },
        );

        /*
         * ====================================================
         * RESPONSE DATA
         * ====================================================
         */

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
      {
        /*
         * Keep the existing configured transaction
         * behavior from Prisma configuration.
         *
         * This option is intentionally NOT changed here.
         */
      },
    );

    /*
     * ========================================================
     * TRANSACTION COMPLETED
     * ========================================================
     */

    perfLog("transaction completed successfully", {
      perfTransferId,
      totalTransactionCallDurationMs: Number(
        (
          performance.now() -
          transactionCallStart
        ).toFixed(2),
      ),
    });

    return result;
  } catch (error) {
    /*
     * ========================================================
     * TRANSACTION FAILED
     * ========================================================
     *
     * This is particularly important for P2028.
     *
     * If "transaction callback started" was never logged
     * for a request, the failure happened while Prisma was
     * trying to start the interactive transaction.
     */

    perfLog("transaction failed", {
      perfTransferId,
      totalTransactionCallDurationMs: Number(
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

/*
 * ============================================================
 * LEGACY AUTHORIZATION-ONLY OPERATION
 * ============================================================
 *
 * Kept for existing authorization regression tests.
 * ============================================================
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