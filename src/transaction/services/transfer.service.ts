import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
import type { AuditContext } from "../../audit/audit.types";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { TransferInput } from "../schemas/transfer.schema";
import { getTransferAuthorizedAccounts } from "../policies/transfer.policy";
import { assertTransferAmountWithinLimits } from "../policies/transaction-limits.policy";
import { assertDailyTransferLimit } from "./transaction-limits.service";

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
  | "AFTER_AUDIT_CREATION"
  | "BEFORE_IDEMPOTENCY_COMPLETION"
  | "AFTER_IDEMPOTENCY_COMPLETION";

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

/* Non-transactional account pre-resolution */

/*
 * Stage 2H-C1:
 * Resolve accounts before opening the interactive transaction.
 *
 * This is only a pre-flight read.
 * The authoritative account state is still obtained
 * inside the transaction with FOR SHARE.
 */

const resolveAccountsByNumber = async (
  accountNumbers: string[],
): Promise<Map<string, LockedAccount>> => {
  const rows = await prisma.$queryRaw<LockedAccount[]>`
    SELECT
      id,
      user_id,
      account_number,
      account_type,
      status
    FROM accounts
    WHERE account_number IN (
      ${Prisma.join(accountNumbers)}
    )
  `;

  return new Map(
    rows.map((account) => [
      account.account_number,
      account,
    ]),
  );
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
  idempotencyRecordId?: string,
  auditContext: AuditContext = {},
) => {
  const amount = new Prisma.Decimal(input.amount);
  assertTransferAmountWithinLimits(amount);
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

  /*
   * Stage 2H-C1
   * Pre-transaction account resolution.
   *
   * This query does not lock anything.
   * It only allows cheap validation to happen
   * before opening the interactive transaction.
   */

  const preflightStart = performance.now();

  const preflightAccounts =
    await resolveAccountsByNumber([
      input.senderAccount,
      input.receiverAccount,
    ]);

  const preflightSender =
    preflightAccounts.get(input.senderAccount);

  const preflightReceiver =
    preflightAccounts.get(input.receiverAccount);

  perfLog("account preflight completed", {
    perfTransferId,
    senderFound: Boolean(preflightSender),
    receiverFound: Boolean(preflightReceiver),
    outsideTransaction: true,
    durationMs: Number(
      (performance.now() - preflightStart).toFixed(2),
    ),
  });

  /* Pre-transaction sender validation */

  if (!preflightSender) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  /* Pre-transaction receiver validation */

  if (!preflightReceiver) {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  /* Pre-transaction same-account validation */

  if (preflightSender.id === preflightReceiver.id) {
    throw new AppError(
      "Sender and receiver accounts must be different",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  /*
   * Pre-transaction authorization.
   *
   * The authoritative sender account is still re-read
   * and locked inside the transaction.
   */

  const authorizationStart = performance.now();

  if (
    user.role === "CUSTOMER" &&
    preflightSender.user_id !== user.id
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

  perfLog("pre-transaction authorization completed", {
    perfTransferId,
    outsideTransaction: true,
    durationMs: Number(
      (
        performance.now() -
        authorizationStart
      ).toFixed(2),
    ),
  });

  /* Pre-transaction status validation */

  if (preflightSender.status !== "ACTIVE") {
    throw new AppError(
      "Sender account is not active",
      409,
      ErrorCode.CONFLICT,
    );
  }

  if (preflightReceiver.status !== "ACTIVE") {
    throw new AppError(
      "Receiver account is not active",
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

        /*
         * 1. Authoritative account locks
         *
         * Lock order remains deterministic.
         * Account -> AccountBalance protocol is preserved.
         */

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

        /*
         * These checks remain inside because the
         * transactional account state is authoritative.
         */

        if (!sender) {
          throw new AppError(
            "Account not found",
            404,
            ErrorCode.RESOURCE_NOT_FOUND,
          );
        }

        if (!receiver) {
          throw new AppError(
            "Account not found",
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

        /*
         * 2. Transactional authorization re-check
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
         * 3. Transactional account status re-check
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
         * 4. Lock both balances in one SQL query
         */

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

        /*
         * 5. Enforce the daily outgoing transfer limit.
         * The sender's balance row is already locked FOR UPDATE, so another
         * transfer/withdrawal from this account must wait until this
         * transaction commits or rolls back before calculating its total.
         */
        await assertDailyTransferLimit(tx, {
          accountId: sender.id,
          currencyCode: currency.code,
          amount,
        });

        /*
         * 6. Authoritative balance check
         */

        if (
          senderBalance.availableBalance.lt(amount)
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

        await writeAuditLog(
          {
            userId: user.id,
            action: "TRANSFER_CREATED",
            resource: "TRANSACTION",
            resourceId: transaction.id,
            description:
              `Fund transfer ${transaction.reference} created from ` +
              `${sender.account_number} to ${receiver.account_number}`,
            ...auditContext,
            metadata: {
              operation: "INTERNAL_FUND_TRANSFER",
              senderAccount: sender.account_number,
              receiverAccount: receiver.account_number,
              amount: amount.toString(),
              currencyCode: currency.code,
              userRole: user.role,
            },
          },
          tx,
        );

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
         * 12. Prepare the existing service result.
         *
         * Keep this structure compatible with the
         * current controller and any existing callers.
         */

        const transferResult = {
          transaction: {
            ...transaction,
            amount: transaction.amount.toString(),
          },

          senderAccount: sender.account_number,

          receiverAccount: receiver.account_number,

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
        };

        /*
         * 13. Complete idempotency inside this transaction.
         *
         * If this update fails, throwing an error aborts
         * the transaction, rolling back the financial writes.
         */

        if (idempotencyRecordId) {
          throwIfTransferTestFailure(
            "BEFORE_IDEMPOTENCY_COMPLETION",
          );

          const responseData = {
            message:
              "Fund transfer completed successfully",
            transaction: transferResult.transaction,
          };

          const completion =
            await tx.idempotencyRecord.updateMany({
              where: {
                id: idempotencyRecordId,
                userId: user.id,
                responseStatus: null,
              },

              data: {
                responseStatus: 200,
                responseBody:
                  JSON.parse(
                    JSON.stringify(responseData),
                  ) as Prisma.InputJsonValue,
              },
            });

          if (completion.count !== 1) {
            throw new AppError(
              "Unable to complete idempotency record",
              409,
              ErrorCode.CONFLICT,
            );
          }
          throwIfTransferTestFailure(
               "AFTER_IDEMPOTENCY_COMPLETION",
          );
        }

        /*
         * Phase 23: transactional outbox.
         *
         * This event is committed atomically with the transfer, ledger,
         * idempotency record and audit log. Redis/queue availability does
         * not affect the financial transaction's commit path.
         */
        await tx.outboxEvent.create({
          data: {
            eventType: "TRANSFER_COMMITTED",
            payload: {
              transactionId: transferResult.transaction.id,
              actorUserId: user.id,
            },
          },
        });

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

        return transferResult;
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
    // Notify only actionable business failures; validation/authentication and
    // unexpected infrastructure errors should not generate noisy user alerts.
    if (
      error instanceof AppError &&
      (error.code === ErrorCode.INSUFFICIENT_BALANCE ||
        error.code === ErrorCode.TRANSACTION_LIMIT_EXCEEDED)
    ) {
      if (prisma.outboxEvent?.create) {
        try {
          await prisma.outboxEvent.create({
            data: {
              eventType: "NOTIFICATION_REQUESTED",
              payload: {
                userId: user.id,
                notificationType: "TRANSFER_FAILED",
                title: "Transfer unsuccessful",
                message: "Your transfer could not be completed. Review your available balance and transaction limits, then try again if appropriate.",
                metadata: {
                  failureCode: error.code,
                },
              },
            },
          });
        } catch (notificationError) {
          // Preserve the original financial-operation error if notification
          // persistence is temporarily unavailable.
          console.error("[transfer] unable to record failure notification", {
            userId: user.id,
            error: notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
          });
        }
      }
    }

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