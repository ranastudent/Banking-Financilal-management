import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, UserRole } from "@prisma/client";

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

import { prisma } from "../../config/prisma";
import { getTransactionHistory } from "../../transaction/history/transaction-history.service";

const customerUser = { id: "customer-user-001", role: UserRole.CUSTOMER };
const adminUser = { id: "admin-user-001", role: UserRole.ADMIN };
const supportUser = { id: "support-user-001", role: UserRole.SUPPORT };
const auditorUser = { id: "auditor-user-001", role: UserRole.AUDITOR };

const accountId = "550e8400-e29b-41d4-a716-446655440000";
const secondAccountId = "550e8400-e29b-41d4-a716-446655440001";

const createTransaction = (overrides: Record<string, unknown> = {}) => ({
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

const getOffsetHistory = (
  user: Parameters<typeof getTransactionHistory>[0],
  query: Parameters<typeof getTransactionHistory>[1],
) => getTransactionHistory(user, query, "offset");

describe("Prisma mock", () => {
  it("uses the mocked Prisma client", () => {
    expect(vi.isMockFunction(prisma.transaction.findMany)).toBe(true);
    expect(vi.isMockFunction(prisma.transaction.count)).toBe(true);
    expect(vi.isMockFunction(prisma.account.findMany)).toBe(true);
  });
});

describe("getTransactionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockAccountFindMany.mockResolvedValue([
      { id: accountId },
      { id: secondAccountId },
    ]);
    mockAccountFindFirst.mockResolvedValue({ id: accountId });
    mockPrismaTransaction.mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );
  });

  describe("pagination", () => {
    it("returns default offset pagination", async () => {
      const result = await getOffsetHistory(adminUser, { page: 1, limit: 20 });

      expect(result).toEqual({
        transactions: [],
        pagination: {
          mode: "offset",
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });
    });

    it("calculates skip and take for the requested page", async () => {
      mockFindMany.mockResolvedValue([createTransaction()]);
      mockCount.mockResolvedValue(45);

      const result = await getOffsetHistory(adminUser, { page: 3, limit: 10 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.pagination).toEqual({
        mode: "offset",
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    it("returns zero total pages when no transactions exist", async () => {
      const result = await getOffsetHistory(adminUser, { page: 1, limit: 20 });

      expect(result.pagination.mode).toBe("offset");
      if (result.pagination.mode !== "offset") {
        throw new Error("Expected offset pagination");
      }

      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it("calculates total pages using ceiling division", async () => {
      mockCount.mockResolvedValue(21);

      const result = await getOffsetHistory(adminUser, { page: 1, limit: 10 });

      expect(result.pagination.mode).toBe("offset");
      if (result.pagination.mode !== "offset") {
        throw new Error("Expected offset pagination");
      }

      expect(result.pagination.total).toBe(21);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe("transaction filters", () => {
    it("filters by transaction type", async () => {
      await getOffsetHistory(adminUser, {
        page: 1,
        limit: 20,
        type: "INTERNAL_TRANSFER",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "INTERNAL_TRANSFER" }),
        }),
      );
    });

    it("filters by transaction status", async () => {
      await getOffsetHistory(adminUser, {
        page: 1,
        limit: 20,
        status: "COMPLETED",
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });

    it("filters by start date", async () => {
      await getOffsetHistory(adminUser, {
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

    it("includes the entire end date", async () => {
      await getOffsetHistory(adminUser, {
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

    it("filters by minimum and maximum amount", async () => {
      await getOffsetHistory(adminUser, {
        page: 1,
        limit: 20,
        minAmount: "100.50",
        maxAmount: "5000.75",
      });

      const where = mockFindMany.mock.calls[0]?.[0].where;

      expect(where.amount.gte.toString()).toBe("100.5");
      expect(where.amount.lte.toString()).toBe("5000.75");
    });

    it("combines transaction filters", async () => {
      await getOffsetHistory(adminUser, {
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

      const where = mockFindMany.mock.calls[0]?.[0].where;

      expect(where).toEqual(
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
                { legs: { some: { accountId } } },
                { ledgerEntries: { some: { accountId } } },
              ],
            },
          ]),
        }),
      );

      expect(where.amount.gte.toString()).toBe("100.5");
      expect(where.amount.lte.toString()).toBe("5000.75");
    });

    it("matches accounts used in transactions, legs, or ledger entries", async () => {
      await getOffsetHistory(adminUser, { page: 1, limit: 20, accountId });

      const where = mockFindMany.mock.calls[0]?.[0].where;

      expect(where.AND).toEqual([
        {
          OR: [
            { sourceAccountId: accountId },
            { destinationAccountId: accountId },
            { legs: { some: { accountId } } },
            { ledgerEntries: { some: { accountId } } },
          ],
        },
      ]);
    });
  });

  describe("sorting", () => {
    it("sorts newest transactions first with a stable secondary sort", async () => {
      await getOffsetHistory(adminUser, { page: 1, limit: 20 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
      );
    });
  });

  describe("customer authorization", () => {
    it("restricts customers to their own accounts", async () => {
      await getOffsetHistory(customerUser, { page: 1, limit: 20 });

      expect(mockAccountFindMany).toHaveBeenCalledWith({
        where: { userId: customerUser.id },
        select: { id: true },
      });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { sourceAccountId: { in: [accountId, secondAccountId] } },
                ]),
              }),
            ]),
          }),
        }),
      );
    });

    it("returns an empty result when a customer has no accounts", async () => {
      mockAccountFindMany.mockResolvedValue([]);

      const result = await getOffsetHistory(customerUser, {
        page: 1,
        limit: 20,
      });

      expect(result).toEqual({
        transactions: [],
        pagination: {
          mode: "offset",
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });

      expect(mockFindMany).not.toHaveBeenCalled();
      expect(mockCount).not.toHaveBeenCalled();
    });

    it("rejects filtering by an account the customer does not own", async () => {
      mockAccountFindFirst.mockResolvedValue(null);

      await expect(
        getOffsetHistory(customerUser, {
          page: 1,
          limit: 20,
          accountId: "550e8400-e29b-41d4-a716-446655440099",
        }),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("support authorization", () => {
    it("restricts support users to transactions involving customer accounts", async () => {
      await getOffsetHistory(supportUser, { page: 1, limit: 20 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  {
                    sourceAccount: {
                      user: { role: UserRole.CUSTOMER },
                    },
                  },
                ]),
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("admin and auditor access", () => {
    it.each([
      ["ADMIN", adminUser],
      ["AUDITOR", auditorUser],
    ] as const)("allows %s to query all transactions", async (_role, user) => {
      await getOffsetHistory(user, { page: 1, limit: 20 });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe("role validation", () => {
    it("rejects an unsupported role", async () => {
      await expect(
        getOffsetHistory(
          { id: "unknown-user", role: "UNKNOWN_ROLE" },
          { page: 1, limit: 20 },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(mockFindMany).not.toHaveBeenCalled();
    });
  });

  describe("database errors", () => {
    it("propagates a database query error", async () => {
      mockPrismaTransaction.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        getOffsetHistory(adminUser, { page: 1, limit: 20 }),
      ).rejects.toThrow("Database connection failed");
    });
  });
});