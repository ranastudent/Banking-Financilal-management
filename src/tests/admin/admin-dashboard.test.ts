import request from "supertest";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  accountCount: vi.fn(),
  transactionGroupBy: vi.fn(),
}));

vi.mock("../../config/prisma", () => ({
  prisma: {
    user: { count: prismaMocks.userCount },
    account: { count: prismaMocks.accountCount },
    transaction: { groupBy: prismaMocks.transactionGroupBy },
  },
}));

import app from "../../app";
import { env } from "../../config/env";
import { getAdminDashboard } from "../../admin/services/dashboard.service";

const transactionGroups = () => [
  { type: "DEPOSIT", status: "COMPLETED", currencyCode: "BDT", _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal("1000") } },
  { type: "EXTERNAL_DEPOSIT", status: "COMPLETED", currencyCode: "BDT", _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal("500") } },
  { type: "DEPOSIT", status: "COMPLETED", currencyCode: "USD", _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal("200") } },
  { type: "WITHDRAWAL", status: "COMPLETED", currencyCode: "BDT", _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal("300") } },
  { type: "INTERNAL_TRANSFER", status: "COMPLETED", currencyCode: "BDT", _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal("400") } },
  { type: "EXTERNAL_TRANSFER", status: "COMPLETED", currencyCode: "USD", _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal("100") } },
  { type: "REFUND", status: "FAILED", currencyCode: "BDT", _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal("50") } },
  { type: "DEPOSIT", status: "PENDING", currencyCode: "BDT", _count: { _all: 3 }, _sum: { amount: new Prisma.Decimal("900") } },
  { type: "INTERNAL_TRANSFER", status: "PROCESSING", currencyCode: "USD", _count: { _all: 4 }, _sum: { amount: new Prisma.Decimal("800") } },
];

const createAccessToken = (role: "ADMIN" | "CUSTOMER" | "SUPPORT" | "AUDITOR") =>
  jwt.sign(
    {
      sub: `phase26-${role.toLowerCase()}-user`,
      email: `${role.toLowerCase()}@example.test`,
      role,
      status: "ACTIVE",
      tokenType: "access",
    },
    env.jwtAccessSecret,
    { expiresIn: "15m" },
  );

const configureMocks = () => {
  prismaMocks.userCount.mockImplementation(async (args?: { where?: { status?: string } }) =>
    args?.where?.status === "BLOCKED" ? 2 : 10,
  );
  prismaMocks.accountCount.mockImplementation(async (args?: { where?: { status?: string } }) =>
    args?.where?.status === "FROZEN" ? 3 : 8,
  );
  prismaMocks.transactionGroupBy.mockResolvedValue(transactionGroups());
};

beforeEach(() => {
  vi.clearAllMocks();
  configureMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Phase 26 admin dashboard service", () => {
  it("calculates the requested metrics and keeps money grouped by currency", async () => {
    const dashboard = await getAdminDashboard();

    expect(dashboard.totalUsers).toBe(10);
    expect(dashboard.totalAccounts).toBe(8);
    expect(dashboard.totalDeposits).toEqual({
      count: 4,
      amountByCurrency: [
        { currencyCode: "BDT", amount: "1500" },
        { currencyCode: "USD", amount: "200" },
      ],
    });
    expect(dashboard.totalWithdrawals).toEqual({
      count: 2,
      amountByCurrency: [{ currencyCode: "BDT", amount: "300" }],
    });
    expect(dashboard.totalTransfers).toEqual({
      count: 3,
      amountByCurrency: [
        { currencyCode: "BDT", amount: "400" },
        { currencyCode: "USD", amount: "100" },
      ],
    });
    expect(dashboard.failedTransactions).toBe(2);
    expect(dashboard.pendingTransactions).toBe(7);
    expect(dashboard.blockedUsers).toBe(2);
    expect(dashboard.frozenAccounts).toBe(3);
    expect(dashboard.blockedAccounts).toBe(3);
  });

  it("uses grouped Prisma aggregation rather than fetching transaction rows", async () => {
    await getAdminDashboard();

    expect(prismaMocks.transactionGroupBy).toHaveBeenCalledWith({
      by: ["type", "status", "currencyCode"],
      _count: { _all: true },
      _sum: { amount: true },
    });
  });

  it("returns valid zero metrics when the database has no records", async () => {
    prismaMocks.userCount.mockResolvedValue(0);
    prismaMocks.accountCount.mockResolvedValue(0);
    prismaMocks.transactionGroupBy.mockResolvedValue([]);

    const dashboard = await getAdminDashboard();

    expect(dashboard).toMatchObject({
      totalUsers: 0,
      totalAccounts: 0,
      totalDeposits: { count: 0, amountByCurrency: [] },
      totalWithdrawals: { count: 0, amountByCurrency: [] },
      totalTransfers: { count: 0, amountByCurrency: [] },
      failedTransactions: 0,
      pendingTransactions: 0,
      blockedAccounts: 0,
      blockedUsers: 0,
      frozenAccounts: 0,
    });
  });
});

describe("Phase 26 admin dashboard route authorization", () => {
  it("allows ADMIN to access the dashboard", async () => {
    const response = await request(app)
      .get("/api/v1/admin/dashboard")
      .set("Authorization", `Bearer ${createAccessToken("ADMIN")}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.data).toMatchObject({
      totalUsers: 10,
      totalAccounts: 8,
      failedTransactions: 2,
      pendingTransactions: 7,
      blockedAccounts: 3,
      blockedUsers: 2,
      frozenAccounts: 3,
    });
  });

  it.each(["CUSTOMER", "SUPPORT", "AUDITOR"] as const)(
    "rejects %s from the admin dashboard",
    async (role) => {
      const response = await request(app)
        .get("/api/v1/admin/dashboard")
        .set("Authorization", `Bearer ${createAccessToken(role)}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("rejects unauthenticated requests", async () => {
    const response = await request(app).get("/api/v1/admin/dashboard");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it.each([
    "/api/v1/admin/users",
    "/api/v1/admin/accounts",
    "/api/v1/admin/transactions",
    "/api/v1/admin/audit-logs",
  ])("keeps the existing %s endpoint mounted and protected", async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
