import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma, UserRole } from "@prisma/client";

describe("Prisma mock diagnostic", () => {
  it("should use the mocked Prisma client", () => {
    expect(vi.isMockFunction(prisma.transaction.findMany)).toBe(true);
    expect(vi.isMockFunction(prisma.transaction.count)).toBe(true);
    expect(vi.isMockFunction(prisma.account.findMany)).toBe(true);
  });
});

// ============================================================
// MOCK PRISMA
// ============================================================

const {
  mockFindMany,
  mockCount,
  mockAccountFindMany,
  mockAccountFindFirst,
  mockPrismaTransaction,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockAccountFindMany: vi.fn(),
  mockAccountFindFirst: vi.fn(),
  mockPrismaTransaction: vi.fn(),
}));

vi.mock("../../config/prisma.ts", () => ({
  prisma: {
    transaction: {
      findMany: mockFindMany,
      count: mockCount,
    },
    account: {
      findMany: mockAccountFindMany,
      findFirst: mockAccountFindFirst,
    },
    $transaction: mockPrismaTransaction,
  },
}));

// ============================================================
// IMPORT SERVICE AFTER MOCK SETUP
// ============================================================

import { getTransactionHistory } from "../../transaction/history/transaction-history.service";
import { prisma } from "../../config/prisma";

// ============================================================
// TEST DATA
// ============================================================

const customerUser = {
  id: "customer-user-001",
  role: UserRole.CUSTOMER,
};

const adminUser = {
  id: "admin-user-001",
  role: UserRole.ADMIN,
};

const supportUser = {
  id: "support-user-001",
  role: UserRole.SUPPORT,
};

const auditorUser = {
  id: "auditor-user-001",
  role: UserRole.AUDITOR,
};

const accountId = "550e8400-e29b-41d4-a716-446655440000";

const secondAccountId = "550e8400-e29b-41d4-a716-446655440001";

const createTransaction = (
  overrides: Record<string, unknown> = {},
) => ({
  id: "transaction-001",
  reference: "TXN-20261021-001",
  type: "INTERNAL_TRANSFER",
  status: "COMPLETED",
  amount: new Prisma.Decimal("2500.00000000"),
  currencyCode: "BDT",
  sourceAccountId: accountId,
  destinationAccountId: secondAccountId,
  createdAt: new Date("2026-10-21T10:30:00.000Z"),
  updatedAt: new Date("2026-10-21T10:30:00.000Z"),
  ...overrides,
});

// ============================================================
// TEST SUITE
// ============================================================

describe("getTransactionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    mockAccountFindMany.mockResolvedValue([
      { id: accountId },
      { id: secondAccountId },
    ]);

    mockAccountFindFirst.mockResolvedValue({
      id: accountId,
    });

    mockPrismaTransaction.mockImplementation(
      async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
    );
  });

  // ==========================================================
  // PAGINATION
  // ==========================================================

  describe("pagination", () => {
    it("should return default pagination values", async () => {
      const result = await getTransactionHistory(
        adminUser,
        {
          page: 1,
          limit: 20,
        },
      );

      expect(result).toEqual({
        transactions: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });
    });

    it("should calculate skip and take for the requested page", async () => {
      mockFindMany.mockResolvedValue([
        createTransaction(),
      ]);

      mockCount.mockResolvedValue(45);

      const result = await getTransactionHistory(
        adminUser,
        {
          page: 3,
          limit: 10,
        },
      );

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );

      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    it("should return zero total pages when no transactions exist", async () => {
      mockCount.mockResolvedValue(0);

      const result = await getTransactionHistory(
        adminUser,
        {
          page: 1,
          limit: 20,
        },
      );

      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it("should calculate total pages using ceiling division", async () => {
      mockCount.mockResolvedValue(21);

      const result = await getTransactionHistory(
        adminUser,
        {
          page: 1,
          limit: 10,
        },
      );

      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ==========================================================
  // FILTERING
  // ==========================================================

  describe("transaction filters", () => {
    it("should filter by transaction type", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
        type: "INTERNAL_TRANSFER",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "INTERNAL_TRANSFER",
          }),
        }),
      );
    });

    it("should filter by transaction status", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
        status: "COMPLETED",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "COMPLETED",
          }),
        }),
      );
    });

    it("should filter by start date", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
        startDate: "2026-10-01",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: new Date("2026-10-01T00:00:00.000Z"),
            }),
          }),
        }),
      );
    });

    it("should include the entire end date", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
        endDate: "2026-10-20",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              lt: new Date("2026-10-21T00:00:00.000Z"),
            }),
          }),
        }),
      );
    });

    it("should filter by minimum and maximum amount", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
        minAmount: "100.50",
        maxAmount: "5000.75",
      });

      const findManyCall = mockFindMany.mock.calls[0]?.[0];
      expect(findManyCall).toBeDefined();

      expect(findManyCall.where.amount.gte.toString()).toBe(
        "100.5",
      );

      expect(findManyCall.where.amount.lte.toString()).toBe(
        "5000.75",
      );
    });

    it("should combine type, status, date, account, and amount filters", async () => {
  await getTransactionHistory(adminUser, {
    page: 1,
    limit: 20,
    type: "INTERNAL_TRANSFER",
    status: "COMPLETED",
    startDate: "2026-10-01",
    endDate: "2026-10-20",
    accountId,
    minAmount: "100.50",
    maxAmount: "5000.75",
  });

  expect(mockFindMany).toHaveBeenCalledTimes(1);

  const findManyCall = mockFindMany.mock.calls[0]?.[0];

  expect(findManyCall).toBeDefined();

  expect(findManyCall.where).toEqual(
    expect.objectContaining({
      type: "INTERNAL_TRANSFER",
      status: "COMPLETED",
      createdAt: {
        gte: new Date("2026-10-01T00:00:00.000Z"),
        lt: new Date("2026-10-21T00:00:00.000Z"),
      },
      amount: expect.objectContaining({
        gte: expect.any(Prisma.Decimal),
        lte: expect.any(Prisma.Decimal),
      }),
      AND: expect.arrayContaining([
        {
          OR: [
            { sourceAccountId: accountId },
            { destinationAccountId: accountId },
            {
              legs: {
                some: {
                  accountId,
                },
              },
            },
            {
              ledgerEntries: {
                some: {
                  accountId,
                },
              },
            },
          ],
        },
      ]),
    }),
  );

  expect(findManyCall.where.amount.gte.toString()).toBe(
    "100.5",
  );

  expect(findManyCall.where.amount.lte.toString()).toBe(
    "5000.75",
  );
    });

    it("should match an account used as source, destination, transaction leg, or ledger entry", async () => {
  await getTransactionHistory(adminUser, {
    page: 1,
    limit: 20,
    accountId,
  });

  const findManyCall = mockFindMany.mock.calls[0]?.[0];

  expect(findManyCall).toBeDefined();

  expect(findManyCall.where.AND).toEqual([
    {
      OR: [
        { sourceAccountId: accountId },
        { destinationAccountId: accountId },
        {
          legs: {
            some: {
              accountId,
            },
          },
        },
        {
          ledgerEntries: {
            some: {
              accountId,
            },
          },
        },
      ],
    },
  ]);
    });

    it("should use identical filters for transaction results and total count", async () => {
  await getTransactionHistory(adminUser, {
    page: 1,
    limit: 20,
    type: "INTERNAL_TRANSFER",
    status: "COMPLETED",
    startDate: "2026-10-01",
    endDate: "2026-10-20",
    accountId,
    minAmount: "100",
    maxAmount: "5000",
  });

  expect(mockFindMany).toHaveBeenCalledTimes(1);
  expect(mockCount).toHaveBeenCalledTimes(1);

  const findManyCall = mockFindMany.mock.calls[0]?.[0];
  const countCall = mockCount.mock.calls[0]?.[0];

  expect(findManyCall).toBeDefined();
  expect(countCall).toBeDefined();

  expect(countCall.where).toEqual(findManyCall.where);
    });
  });

  // ==========================================================
  // SORTING
  // ==========================================================

  describe("sorting", () => {
    it("should sort by newest transaction first with a stable secondary sort", async () => {
      await getTransactionHistory(adminUser, {
        page: 1,
        limit: 20,
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
        }),
      );
    });
  });

  // ==========================================================
  // CUSTOMER AUTHORIZATION
  // ==========================================================

  describe("customer authorization", () => {
    it("should restrict customers to their own accounts", async () => {
      await getTransactionHistory(customerUser, {
        page: 1,
        limit: 20,
      });

      expect(mockAccountFindMany).toHaveBeenCalledWith({
        where: {
          userId: customerUser.id,
        },
        select: {
          id: true,
        },
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    sourceAccountId: {
                      in: [accountId, secondAccountId],
                    },
                  }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });

    it("should return an empty result when a customer has no accounts", async () => {
      mockAccountFindMany.mockResolvedValue([]);

      const result = await getTransactionHistory(
        customerUser,
        {
          page: 1,
          limit: 20,
        },
      );

      expect(result).toEqual({
        transactions: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });

      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCount).not.toHaveBeenCalled();
    });

    it("should reject a customer attempting to filter by an unowned account", async () => {
      mockAccountFindFirst.mockResolvedValue(null);

      await expect(
        getTransactionHistory(customerUser, {
          page: 1,
          limit: 20,
          accountId: "550e8400-e29b-41d4-a716-446655440099",
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
      });

      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================
  // SUPPORT AUTHORIZATION
  // ==========================================================

  describe("support authorization", () => {
    it("should restrict support users to transactions involving customer accounts", async () => {
      await getTransactionHistory(supportUser, {
        page: 1,
        limit: 20,
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    sourceAccount: {
                      user: {
                        role: UserRole.CUSTOMER,
                      },
                    },
                  }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });
  });

  // ==========================================================
  // ADMIN AND AUDITOR
  // ==========================================================

  describe("admin and auditor access", () => {
    it.each([
      ["ADMIN", adminUser],
      ["AUDITOR", auditorUser],
    ] as const)(
      "should allow %s to query all transactions",
      async (_role, user) => {
        await getTransactionHistory(user, {
          page: 1,
          limit: 20,
        });

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
          }),
        );
      },
    );
  });

  // ==========================================================
  // INVALID ROLE
  // ==========================================================

  describe("role validation", () => {
    it("should reject an unsupported role", async () => {
      await expect(
        getTransactionHistory(
          {
            id: "unknown-user",
            role: "UNKNOWN_ROLE",
          },
          {
            page: 1,
            limit: 20,
          },
        ),
      ).rejects.toMatchObject({
        statusCode: 403,
      });

      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  // ==========================================================
  // DATABASE ERRORS
  // ==========================================================

  describe("database errors", () => {
    it("should propagate a database query error", async () => {
      mockPrismaTransaction.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        getTransactionHistory(adminUser, {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow("Database connection failed");
    });
  });
});