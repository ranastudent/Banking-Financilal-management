import type { Request, Response } from "express";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ============================================================
// MOCKS
// ============================================================

const { mockGetTransactionHistory } = vi.hoisted(() => ({
  mockGetTransactionHistory: vi.fn(),
}));

vi.mock(
  "../../transaction/history/transaction-history.service",
  () => ({
    getTransactionHistory: mockGetTransactionHistory,
  }),
);

// Import the controller after configuring the mock.
import {
  getTransactionHistoryController,
} from "../../transaction/controllers/transaction-history.controller";

// ============================================================
// TEST HELPERS
// ============================================================

const makeResponse = () => {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);

  return res;
};

// ============================================================
// CONTROLLER TESTS
// ============================================================

describe("getTransactionHistoryController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------
  // 1. Successful response
  // ----------------------------------------------------------

  it(
    "returns transactions and pagination in the expected response",
    async () => {
      const result = {
        transactions: [
          {
            id: "transaction-001",
          },
        ],
        pagination: {
          page: 2,
          limit: 10,
          total: 11,
          totalPages: 2,
        },
      };

      mockGetTransactionHistory.mockResolvedValue(result);

      const req = {
        user: {
          id: "user-001",
          email: "user@example.com",
          role: "ADMIN",
          status: "ACTIVE",
        },
        validatedQuery: {
          page: 2,
          limit: 10,
        },
        requestId: "request-001",
      } as unknown as Request;

      const res = makeResponse() as unknown as Response;

      await getTransactionHistoryController(req, res);

      expect(mockGetTransactionHistory).toHaveBeenCalledWith(
        req.user,
        {
          page: 2,
          limit: 10,
        },
        "cursor",
      );

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          transactions: result.transactions,
          pagination: result.pagination,
        },
        requestId: "request-001",
      });
    },
  );

  // ----------------------------------------------------------
  // 2. Missing authenticated user
  // ----------------------------------------------------------

  it(
    "rejects requests without an authenticated user",
    async () => {
      const req = {
        requestId: "request-002",
        validatedQuery: {
          page: 1,
          limit: 20,
        },
      } as unknown as Request;

      const res = makeResponse() as unknown as Response;

      await expect(
        getTransactionHistoryController(req, res),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: "UNAUTHORIZED",
      });

      expect(
        mockGetTransactionHistory,
      ).not.toHaveBeenCalled();
    },
  );

  // ----------------------------------------------------------
  // 3. Default query parameters
  // ----------------------------------------------------------

  it(
    "uses default query values when validation middleware has not populated the query",
    async () => {
      mockGetTransactionHistory.mockResolvedValue({
        transactions: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });

      const req = {
        user: {
          id: "user-002",
          email: "admin@example.com",
          role: "ADMIN",
          status: "ACTIVE",
        },
        query: {},
        requestId: "request-003",
      } as unknown as Request;

      const res = makeResponse() as unknown as Response;

      await getTransactionHistoryController(req, res);

      expect(mockGetTransactionHistory).toHaveBeenCalledWith(
        req.user,
        {
          page: 1,
          limit: 20,
        },
        "cursor",
      );

      expect(res.status).toHaveBeenCalledWith(200);
    },
  );

  // ----------------------------------------------------------
  // 4. Invalid query parameters
  // ----------------------------------------------------------

  it(
    "rejects invalid query parameters when validation middleware has not populated the query",
    async () => {
      const req = {
        user: {
          id: "user-003",
          email: "admin@example.com",
          role: "ADMIN",
          status: "ACTIVE",
        },
        query: {
          page: "0",
        },
        requestId: "request-004",
      } as unknown as Request;

      const res = makeResponse() as unknown as Response;

      await expect(
        getTransactionHistoryController(req, res),
      ).rejects.toMatchObject({
        name: "ZodError",
      });

      expect(
        mockGetTransactionHistory,
      ).not.toHaveBeenCalled();
    },
  );
});