import { afterEach, describe, expect, it, vi } from "vitest";

import { prisma } from "../../config/prisma";
import { getCustomerOwnedAccount } from "../../account/policies/account.policy";
import { getCustomerOwnedTransaction } from "../../transaction/policies/transaction.policy";
import { getCustomerOwnedBeneficiary } from "../../transaction/policies/beneficiary.policy";
import { getCustomerOwnedFxRequest } from "../../transaction/policies/fx-request.policy";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("9.9.3 CUSTOMER Ownership Policies", () => {
  describe("Account ownership", () => {
    it("should allow access when the account belongs to the customer", async () => {
      const customerId = "customer-1";
      const accountId = "account-1";

      const account = {
        id: accountId,
        userId: customerId,
      };

      vi.spyOn(prisma.account, "findUnique").mockResolvedValue(
        account as never,
      );

      await expect(
        getCustomerOwnedAccount(accountId, customerId),
      ).resolves.toEqual(account);

      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: {
          id: accountId,
        },
      });
    });

    it("should deny access when the account belongs to another customer", async () => {
      const customerId = "customer-1";
      const ownerId = "customer-2";
      const accountId = "account-2";

      const account = {
        id: accountId,
        userId: ownerId,
      };

      vi.spyOn(prisma.account, "findUnique").mockResolvedValue(
        account as never,
      );

      await expect(
        getCustomerOwnedAccount(accountId, customerId),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "You do not have permission to access this account",
      });
    });
  });

  describe("Transaction ownership", () => {
    it("should allow access when the customer owns the source account", async () => {
      const customerId = "customer-1";
      const sourceAccountId = "account-owned";
      const destinationAccountId = "account-other";
      const transactionId = "transaction-1";

      const transaction = {
        id: transactionId,
        sourceAccountId,
        destinationAccountId,
      };

      vi.spyOn(
        prisma.transaction,
        "findUnique",
      ).mockResolvedValue(transaction as never);

      const findFirstSpy = vi
        .spyOn(prisma.account, "findFirst")
        .mockResolvedValue({
          id: sourceAccountId,
        } as never);

      await expect(
        getCustomerOwnedTransaction(
          transactionId,
          customerId,
        ),
      ).resolves.toEqual(transaction);

      expect(findFirstSpy).toHaveBeenCalledWith({
        where: {
          userId: customerId,
          id: {
            in: [
              sourceAccountId,
              destinationAccountId,
            ],
          },
        },
        select: {
          id: true,
        },
      });
    });

    it("should allow access when the customer owns the destination account", async () => {
      const customerId = "customer-1";
      const sourceAccountId = "account-other";
      const destinationAccountId = "account-owned";
      const transactionId = "transaction-2";

      const transaction = {
        id: transactionId,
        sourceAccountId,
        destinationAccountId,
      };

      vi.spyOn(
        prisma.transaction,
        "findUnique",
      ).mockResolvedValue(transaction as never);

      vi.spyOn(
        prisma.account,
        "findFirst",
      ).mockResolvedValue({
        id: destinationAccountId,
      } as never);

      await expect(
        getCustomerOwnedTransaction(
          transactionId,
          customerId,
        ),
      ).resolves.toEqual(transaction);
    });

    it("should deny access when the customer owns neither account", async () => {
      const customerId = "customer-1";
      const transactionId = "transaction-3";

      const transaction = {
        id: transactionId,
        sourceAccountId: "account-other-1",
        destinationAccountId: "account-other-2",
      };

      vi.spyOn(
        prisma.transaction,
        "findUnique",
      ).mockResolvedValue(transaction as never);

      vi.spyOn(
        prisma.account,
        "findFirst",
      ).mockResolvedValue(null);

      await expect(
        getCustomerOwnedTransaction(
          transactionId,
          customerId,
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "You do not have permission to access this transaction",
      });
    });

    it("should deny access when a transaction has no source or destination account", async () => {
      const customerId = "customer-1";
      const transactionId = "transaction-4";

      const transaction = {
        id: transactionId,
        sourceAccountId: null,
        destinationAccountId: null,
      };

      vi.spyOn(
        prisma.transaction,
        "findUnique",
      ).mockResolvedValue(transaction as never);

      const findFirstSpy = vi.spyOn(
        prisma.account,
        "findFirst",
      );

      await expect(
        getCustomerOwnedTransaction(
          transactionId,
          customerId,
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "You do not have permission to access this transaction",
      });

      expect(findFirstSpy).not.toHaveBeenCalled();
    });
  });

  describe("Beneficiary ownership", () => {
    it("should allow access when the beneficiary belongs to the customer", async () => {
      const customerId = "customer-1";
      const beneficiaryId = "beneficiary-1";

      const beneficiary = {
        id: beneficiaryId,
        userId: customerId,
      };

      vi.spyOn(
        prisma.beneficiary,
        "findUnique",
      ).mockResolvedValue(beneficiary as never);

      await expect(
        getCustomerOwnedBeneficiary(
          beneficiaryId,
          customerId,
        ),
      ).resolves.toEqual(beneficiary);
    });

    it("should deny access when the beneficiary belongs to another customer", async () => {
      const customerId = "customer-1";
      const beneficiaryId = "beneficiary-2";

      const beneficiary = {
        id: beneficiaryId,
        userId: "customer-2",
      };

      vi.spyOn(
        prisma.beneficiary,
        "findUnique",
      ).mockResolvedValue(beneficiary as never);

      await expect(
        getCustomerOwnedBeneficiary(
          beneficiaryId,
          customerId,
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "You do not have permission to access this beneficiary",
      });
    });
  });

  describe("FX request ownership", () => {
    it("should allow access when the FX request belongs to the customer", async () => {
      const customerId = "customer-1";
      const requestId = "fx-request-1";

      const fxRequest = {
        id: requestId,
        userId: customerId,
      };

      vi.spyOn(
        prisma.foreignCurrencyRequest,
        "findUnique",
      ).mockResolvedValue(fxRequest as never);

      await expect(
        getCustomerOwnedFxRequest(
          requestId,
          customerId,
        ),
      ).resolves.toEqual(fxRequest);
    });

    it("should deny access when the FX request belongs to another customer", async () => {
      const customerId = "customer-1";
      const requestId = "fx-request-2";

      const fxRequest = {
        id: requestId,
        userId: "customer-2",
      };

      vi.spyOn(
        prisma.foreignCurrencyRequest,
        "findUnique",
      ).mockResolvedValue(fxRequest as never);

      await expect(
        getCustomerOwnedFxRequest(
          requestId,
          customerId,
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "You do not have permission to access this FX request",
      });
    });
  });
});