import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { DepositInput } from "../../account/schemas/deposit.schema";
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
    /*
     * Lock the account row for the duration of the transaction.
     *
     * All future deposit balance mutations will happen inside
     * this same transaction after this lock is acquired.
     *
     * FOR UPDATE prevents concurrent financial operations from
     * reading and updating the same account simultaneously.
     */
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

    /*
     * Defense-in-depth ownership check.
     *
     * Route-level RBAC already allows only CUSTOMER and ADMIN,
     * but financial authorization must also be enforced here.
     */
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

    /*
     * Financial operations are not allowed on frozen or closed
     * accounts.
     */
    if (account.status !== "ACTIVE") {
      throw new AppError(
        "Deposits are not allowed for inactive accounts",
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * Validate the requested currency inside the same transaction.
     */
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

    /*
     * Return only the information required by the controller.
     *
     * No balance mutation or transaction creation occurs yet.
     */
    return {
      account: {
        id: account.id,
        userId: account.user_id,
        accountNumber: account.account_number,
        accountType: account.account_type,
        status: account.status,
      },
      currency,
      amount: new Prisma.Decimal(input.amount),
    };
  });
};