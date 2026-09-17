import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { DepositInput } from "../../account/schemas/deposit.schema";
import type { AuthUser } from "../../types/auth";
import { randomUUID } from "crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LockedAccountRow = {
  id: string;
  user_id: string;
  account_number: string;
  account_type: string;
  status: string;
};

const lockDepositAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<LockedAccountRow> => {
  const accounts = await tx.$queryRaw<LockedAccountRow[]>`
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

const createDepositTransaction = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  amount: Prisma.Decimal,
  currencyCode: string,
) => {
  return tx.transaction.create({
    data: {
      reference: `DEP-${randomUUID()}`,
      type: "DEPOSIT",
      status: "PENDING",
      amount,
      currencyCode,
      provider: "INTERNAL",
      destinationAccountId: accountId,
      metadata: {
        operation: "ACCOUNT_DEPOSIT",
      },
    },
  });
};

const updateDepositBalance = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  currencyCode: string,
  amount: Prisma.Decimal,
) => {
  const existingBalance = await tx.accountBalance.findUnique({
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

  if (!existingBalance) {
    const createdBalance = await tx.accountBalance.create({
      data: {
        accountId,
        currencyCode,
        availableBalance: amount,
        lockedBalance: new Prisma.Decimal(0),
      },
      select: {
        id: true,
        availableBalance: true,
        lockedBalance: true,
      },
    });

    return {
      id: createdBalance.id,
      balanceBefore: new Prisma.Decimal(0),
      balanceAfter: createdBalance.availableBalance,
      lockedBalance: createdBalance.lockedBalance,
      currencyCode,
    };
  }

  const updatedBalance = await tx.accountBalance.update({
    where: {
      id: existingBalance.id,
    },
    data: {
      availableBalance: {
        increment: amount,
      },
    },
    select: {
      id: true,
      availableBalance: true,
      lockedBalance: true,
    },
  });

  return {
    id: updatedBalance.id,
    balanceBefore: existingBalance.availableBalance,
    balanceAfter: updatedBalance.availableBalance,
    lockedBalance: updatedBalance.lockedBalance,
    currencyCode,
  };
};

export const prepareDeposit = async (
  user: AuthUser,
  accountId: string,
  input: DepositInput,
) => {
  if (!UUID_REGEX.test(accountId)) {
    throw new AppError(
      "Invalid account ID",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  return prisma.$transaction(async (tx) => {
    const account = await lockDepositAccount(
      tx,
      accountId,
    );

    if (
      user.role === "CUSTOMER" &&
      account.user_id !== user.id
    ) {
      throw new AppError(
        "You do not have permission to deposit into this account",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    if (
      user.role !== "CUSTOMER" &&
      user.role !== "ADMIN"
    ) {
      throw new AppError(
        "You do not have permission to perform a deposit",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    if (account.status !== "ACTIVE") {
      throw new AppError(
        "Deposits are not allowed for inactive accounts",
        409,
        ErrorCode.CONFLICT,
      );
    }

    const currency = await tx.currency.findUnique({
      where: {
        code: input.currency,
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

    const amount = new Prisma.Decimal(
      input.amount,
    );

    const transaction =
      await createDepositTransaction(
        tx,
        account.id,
        amount,
        currency.code,
      );

    const balance    = 
      await updateDepositBalance(
        tx,
        account.id,
        currency.code,
        amount,
      );

     return {
      account: {
        id: account.id,
        userId: account.user_id,
        accountNumber: account.account_number,
        accountType: account.account_type,
        status: account.status,
      },
      currency,
      amount,

      balance: {
        id: balance.id,
        currencyCode: balance.currencyCode,
        balanceBefore: balance.balanceBefore.toString(),
        balanceAfter: balance.balanceAfter.toString(),
        lockedBalance: balance.lockedBalance.toString(),
      },

      transaction: {
        id: transaction.id,
        reference: transaction.reference,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount.toString(),
        currencyCode: transaction.currencyCode,
        provider: transaction.provider,
        destinationAccountId: transaction.destinationAccountId,
      },
    };
  });
};