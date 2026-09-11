import { getTransferAuthorizedAccounts } from "../policies/transfer.policy";

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