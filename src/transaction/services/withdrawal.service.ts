import { getWithdrawalAuthorizedAccount } from "../policies/withdrawal.policy";

export const authorizeWithdrawal = async (
  accountId: string,
  userId: string,
  userRole: string,
) => {
  return getWithdrawalAuthorizedAccount(
    accountId,
    userId,
    userRole,
  );
};