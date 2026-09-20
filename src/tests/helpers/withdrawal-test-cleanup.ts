import { prisma } from "../../config/prisma";

type WithdrawalTestCleanupParams = {
  transactionIds: string[];
  accountIds: string[];
  userIds: string[];
};

export const cleanupWithdrawalTestData = async ({
  transactionIds,
  accountIds,
  userIds,
}: WithdrawalTestCleanupParams): Promise<void> => {
  /*
   * LedgerEntry depends on both Account and Transaction.
   * Therefore it must be deleted first.
   */
  if (transactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: transactionIds,
        },
      },
    });
  }

  /*
   * AccountBalance depends on Account.
   */
  if (accountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: {
          in: accountIds,
        },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: {
          in: accountIds,
        },
      },
    });
  }

  /*
   * User-dependent records must be removed before User.
   */
  if (userIds.length > 0) {
    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }
};