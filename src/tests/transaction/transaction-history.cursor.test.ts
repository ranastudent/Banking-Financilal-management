import "../setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionStatus, TransactionType } from "@prisma/client";

const { findManyMock, countMock, accountFindManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  accountFindManyMock: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    transaction: {
      findMany: findManyMock,
      count: countMock,
    },
    account: {
      findMany: accountFindManyMock,
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { getTransactionHistory } from "../../transaction/history/transaction-history.service";
import {
  getTransactionPaginationMode,
  transactionHistoryQuerySchema,
} from "../../transaction/validation/transaction-history-query";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "ADMIN",
};

const createTransaction = (
  id: string,
  createdAt: string,
) => ({
  id,
  createdAt: new Date(createdAt),
  type: TransactionType.DEPOSIT,
  status: TransactionStatus.COMPLETED,
  amount: "100.00",
  sourceAccountId: null,
  destinationAccountId: null,
  sourceAccount: null,
  destinationAccount: null,
  legs: [],
  ledgerEntries: [],
});

const transactions = [
  createTransaction(
    "11111111-1111-4111-8111-111111111113",
    "2026-10-20T12:00:00.000Z",
  ),
  createTransaction(
    "11111111-1111-4111-8111-111111111112",
    "2026-10-20T12:00:00.000Z",
  ),
  createTransaction(
    "11111111-1111-4111-8111-111111111111",
    "2026-10-19T12:00:00.000Z",
  ),
];

const parseQuery = (
  query: Record<string, string>,
) => transactionHistoryQuerySchema.parse(query);

describe("Transaction history cursor pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    accountFindManyMock.mockResolvedValue([]);
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    vi.mocked(prisma.$transaction).mockImplementation(
      async (input: unknown) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }

        throw new Error("Unexpected Prisma transaction input");
      },
    );
  });

  describe("pagination mode selection", () => {
    it("uses cursor mode when page is omitted", () => {
      expect(
        getTransactionPaginationMode({ limit: "20" }),
      ).toBe("cursor");
    });

    it("uses cursor mode when no pagination parameters are supplied", () => {
      expect(getTransactionPaginationMode({})).toBe("cursor");
    });

    it("uses cursor mode when a cursor is supplied", () => {
      expect(
        getTransactionPaginationMode({
          limit: "20",
          cursor: "dGVzdA",
        }),
      ).toBe("cursor");
    });

    it("uses offset mode when page is explicitly supplied", () => {
      expect(
        getTransactionPaginationMode({
          page: "1",
          limit: "20",
        }),
      ).toBe("offset");
    });

    it("rejects page and cursor together", () => {
      expect(() =>
        getTransactionPaginationMode({
          page: "1",
          cursor: "dGVzdA",
        }),
      ).toThrow(AppError);
    });
  });

  describe("query validation", () => {
    it("defaults limit to 20 and page to 1", () => {
      const query = parseQuery({});

      expect(query.limit).toBe(20);
      expect(query.page).toBe(1);
    });

    it("accepts a valid cursor token", () => {
      const query = parseQuery({
        limit: "2",
        cursor: "dGVzdA",
      });

      expect(query.cursor).toBe("dGVzdA");
      expect(query.limit).toBe(2);
    });

    it("rejects an empty cursor", () => {
      expect(() =>
        parseQuery({
          cursor: "",
        }),
      ).toThrow();
    });

    it("rejects invalid cursor characters", () => {
      expect(() =>
        parseQuery({
          cursor: "invalid+cursor/",
        }),
      ).toThrow();
    });

    it("rejects a cursor longer than 512 characters", () => {
      expect(() =>
        parseQuery({
          cursor: "a".repeat(513),
        }),
      ).toThrow();
    });

    it("rejects page and cursor together", () => {
      expect(() =>
        parseQuery({
          page: "1",
          cursor: "dGVzdA",
        }),
      ).toThrow();
    });

    it("rejects a limit greater than 100", () => {
      expect(() =>
        parseQuery({
          limit: "101",
        }),
      ).toThrow();
    });
  });

  describe("first cursor page", () => {
    it("fetches limit plus one records to detect another page", async () => {
      findManyMock.mockResolvedValue([
        ...transactions.slice(0, 3),
      ]);

      const query = parseQuery({ limit: "2" });

      const result = await getTransactionHistory(
        USER,
        query,
        "cursor",
      );

      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3,
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
        }),
      );

      expect(result.transactions).toHaveLength(2);
      expect(result.pagination).toMatchObject({
        mode: "cursor",
        limit: 2,
        hasNextPage: true,
      });
    });

    it("returns a next cursor when another page exists", async () => {
      findManyMock.mockResolvedValue([
        ...transactions.slice(0, 3),
      ]);

      const result = await getTransactionHistory(
        USER,
        parseQuery({ limit: "2" }),
        "cursor",
      );

      expect(result.pagination.mode).toBe("cursor");

      if (result.pagination.mode !== "cursor") {
        throw new Error("Expected cursor pagination");
      }

      expect(result.pagination.nextCursor).toEqual(
        expect.any(String),
      );

      expect(result.pagination.nextCursor!.length).toBeGreaterThan(0);
      expect(result.pagination.hasNextPage).toBe(true);
    });

    it("returns no next cursor when there are no more records", async () => {
      findManyMock.mockResolvedValue(
        transactions.slice(0, 2),
      );

      const result = await getTransactionHistory(
        USER,
        parseQuery({ limit: "2" }),
        "cursor",
      );

      expect(result.transactions).toHaveLength(2);
      expect(result.pagination).toEqual({
        mode: "cursor",
        limit: 2,
        hasNextPage: false,
        nextCursor: null,
      });
    });

    it("returns an empty cursor page correctly", async () => {
      findManyMock.mockResolvedValue([]);

      const result = await getTransactionHistory(
        USER,
        parseQuery({ limit: "2" }),
        "cursor",
      );

      expect(result.transactions).toEqual([]);
      expect(result.pagination).toEqual({
        mode: "cursor",
        limit: 2,
        hasNextPage: false,
        nextCursor: null,
      });
    });
  });

  describe("keyset pagination", () => {
  it("applies the correct cursor boundary to the next page", async () => {
    findManyMock.mockResolvedValueOnce([
      ...transactions,
    ]);

    const firstPage = await getTransactionHistory(
      USER,
      parseQuery({ limit: "2" }),
      "cursor",
    );

    expect(firstPage.transactions).toHaveLength(2);
    expect(firstPage.pagination.mode).toBe("cursor");

    if (firstPage.pagination.mode !== "cursor") {
      throw new Error("Expected cursor pagination");
    }

    const nextCursor = firstPage.pagination.nextCursor;

    expect(nextCursor).toEqual(expect.any(String));

    if (!nextCursor) {
      throw new Error("Expected a next cursor");
    }

    findManyMock.mockClear();
    findManyMock.mockResolvedValueOnce([]);

    await getTransactionHistory(
      USER,
      parseQuery({
        limit: "2",
        cursor: nextCursor,
      }),
      "cursor",
    );

    const secondPageQuery = findManyMock.mock.calls[0]?.[0];
    

    expect(secondPageQuery.take).toBe(3);
    expect(secondPageQuery.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);

    expect(secondPageQuery.where).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                createdAt: expect.objectContaining({
                  lt: expect.any(Date),
                }),
              }),
              expect.objectContaining({
                createdAt: expect.any(Date),
                id: expect.objectContaining({
                  lt: expect.any(String),
                }),
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("uses deterministic ordering for cursor pagination", async () => {
    findManyMock.mockResolvedValueOnce([]);

    await getTransactionHistory(
      USER,
      parseQuery({ limit: "5" }),
      "cursor",
    );

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });
});

  describe("offset pagination compatibility", () => {
    it("preserves offset pagination when page is explicit", async () => {
      const mockTransaction = transactions[0];

      vi.mocked(prisma.$transaction).mockResolvedValue([
        [mockTransaction],
        3,
      ] as never);

      const result = await getTransactionHistory(
        USER,
        parseQuery({
          page: "2",
          limit: "1",
        }),
        "offset",
      );

      expect(result.pagination).toEqual({
        mode: "offset",
        page: 2,
        limit: 1,
        total: 3,
        totalPages: 3,
      });
    });
  });
});