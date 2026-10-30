import "../setup";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getCustomerOwnedAccount: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    account: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock("../../account/policies/account.policy", () => ({
  getCustomerOwnedAccount: mocks.getCustomerOwnedAccount,
}));

import { getTransferAuthorizedAccounts } from "../../transaction/policies/transfer.policy";

const sourceAccount = {
  id: "source-account",
  userId: "customer-1",
  accountNumber: "10000001",
  status: "ACTIVE",
};

const destinationAccount = {
  id: "destination-account",
  userId: "customer-2",
  accountNumber: "10000002",
  status: "ACTIVE",
};

describe("transfer policy unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCustomerOwnedAccount.mockResolvedValue(sourceAccount);
    mocks.findUnique.mockResolvedValue(destinationAccount);
  });

  it("rejects transfers where source and destination are the same account before database access", async () => {
    await expect(
      getTransferAuthorizedAccounts(
        "same-account",
        "same-account",
        "customer-1",
        "CUSTOMER",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: expect.any(String),
    });

    expect(mocks.getCustomerOwnedAccount).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each(["SUPPORT", "AUDITOR", "UNKNOWN_ROLE"])(
    "rejects transfer initiation for role %s",
    async (role) => {
      await expect(
        getTransferAuthorizedAccounts(
          "source-account",
          "destination-account",
          "user-1",
          role,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(mocks.findUnique).not.toHaveBeenCalled();
    },
  );

  it("allows a customer only after resolving their owned source account and an existing destination", async () => {
    const result = await getTransferAuthorizedAccounts(
      "source-account",
      "destination-account",
      "customer-1",
      "CUSTOMER",
    );

    expect(mocks.getCustomerOwnedAccount).toHaveBeenCalledWith(
      "source-account",
      "customer-1",
    );
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "destination-account" },
    });
    expect(result).toEqual({
      sourceAccount,
      destinationAccount,
    });
  });

  it("rejects a customer transfer when the destination account does not exist", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    await expect(
      getTransferAuthorizedAccounts(
        "source-account",
        "missing-destination",
        "customer-1",
        "CUSTOMER",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("allows an admin when both accounts exist", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);

    const result = await getTransferAuthorizedAccounts(
      "source-account",
      "destination-account",
      "admin-1",
      "ADMIN",
    );

    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sourceAccount, destinationAccount });
  });

  it("rejects an admin transfer when the source account does not exist", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(destinationAccount);

    await expect(
      getTransferAuthorizedAccounts(
        "missing-source",
        "destination-account",
        "admin-1",
        "ADMIN",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
