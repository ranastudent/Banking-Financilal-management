import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  overrides: {
    name?: string;
    email?: string;
    phone?: string;
  } = {},
) => {
  const user = await prisma.user.create({
    data: {
      name:
        overrides.name ??
        `Support Lookup ${role} ${crypto.randomUUID()}`,

      email:
        overrides.email ??
        `support-lookup-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,

      phone:
        overrides.phone ?? null,

      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createAccessToken = (
  userId: string,
  email: string,
  role: string,
  status = "ACTIVE",
) => {
  return jwt.sign(
    {
      sub: userId,
      email,
      role,
      status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
};

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: crypto.randomUUID(),
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

describe("SUPPORT Customer Lookup Authorization", () => {
  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }

    const ids = [...createdUserIds];

    createdUserIds.length = 0;

    await prisma.user.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  });

  it("should allow SUPPORT to lookup a customer by name", async () => {
    const support = await createUser("SUPPORT");

    const customer = await createUser("CUSTOMER", {
      name: "Rahim Ahmed",
      email: `rahim-${crypto.randomUUID()}@example.com`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "Rahim",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(
      response.body.data.customers.some(
        (item: { id: string }) => item.id === customer.id,
      ),
    ).toBe(true);
  });

  it("should lookup customer by email case-insensitively", async () => {
    const support = await createUser("SUPPORT");

    const customer = await createUser("CUSTOMER", {
      name: "Email Customer",
      email: `Lookup.Email.${crypto.randomUUID()}@Example.COM`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: customer.email.toLowerCase(),
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(
      response.body.data.customers.some(
        (item: { id: string }) => item.id === customer.id,
      ),
    ).toBe(true);
  });

  it("should lookup customer by phone", async () => {
    const support = await createUser("SUPPORT");

    const customer = await createUser("CUSTOMER", {
      name: "Phone Customer",
      phone: "01712345678",
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "01712345678",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    expect(
      response.body.data.customers.some(
        (item: { id: string }) => item.id === customer.id,
      ),
    ).toBe(true);
  });

  it("should return only CUSTOMER users", async () => {
    const support = await createUser("SUPPORT");

    const customer = await createUser("CUSTOMER", {
      name: "Target Customer",
      email: `target-${crypto.randomUUID()}@example.com`,
    });

    const admin = await createUser("ADMIN", {
      name: "Target Customer Admin",
      email: `target-admin-${crypto.randomUUID()}@example.com`,
    });

    const otherSupport = await createUser("SUPPORT", {
      name: "Target Customer Support",
      email: `target-support-${crypto.randomUUID()}@example.com`,
    });

    const auditor = await createUser("AUDITOR", {
      name: "Target Customer Auditor",
      email: `target-auditor-${crypto.randomUUID()}@example.com`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "Target Customer",
        limit: 100,
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const ids = response.body.data.customers.map(
      (item: { id: string }) => item.id,
    );

    expect(ids).toContain(customer.id);
    expect(ids).not.toContain(admin.id);
    expect(ids).not.toContain(otherSupport.id);
    expect(ids).not.toContain(auditor.id);
  });

  it("should support pagination", async () => {
    const support = await createUser("SUPPORT");

    await createUser("CUSTOMER", {
      name: "Pagination Customer One",
      email: `pagination-one-${crypto.randomUUID()}@example.com`,
    });

    await createUser("CUSTOMER", {
      name: "Pagination Customer Two",
      email: `pagination-two-${crypto.randomUUID()}@example.com`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "Pagination Customer",
        page: 1,
        limit: 1,
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.customers).toHaveLength(1);

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(1);
    expect(response.body.data.pagination.total).toBe(2);
    expect(response.body.data.pagination.totalPages).toBe(2);
  });

  it("should reject an empty search term", async () => {
    const support = await createUser("SUPPORT");

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject an excessively long search term", async () => {
    const support = await createUser("SUPPORT");

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "a".repeat(101),
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject unauthenticated access", async () => {
    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "customer",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject CUSTOMER from customer lookup", async () => {
    const customer = await createUser("CUSTOMER");

    const token = createAccessToken(
      customer.id,
      customer.email,
      customer.role,
      customer.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "customer",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject ADMIN from the SUPPORT customer lookup route", async () => {
    const admin = await createUser("ADMIN");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "customer",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from the SUPPORT customer lookup route", async () => {
    const auditor = await createUser("AUDITOR");

    const token = createAccessToken(
      auditor.id,
      auditor.email,
      auditor.role,
      auditor.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "customer",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should not expose passwordHash or password", async () => {
    const support = await createUser("SUPPORT");

    await createUser("CUSTOMER", {
      name: "Sensitive Field Customer",
      email: `sensitive-${crypto.randomUUID()}@example.com`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "Sensitive Field Customer",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const customer =
      response.body.data.customers[0];

    expect(customer).not.toHaveProperty("passwordHash");
    expect(customer).not.toHaveProperty("password");
  });

  it("should include requestId on a successful lookup", async () => {
    const support = await createUser("SUPPORT");

    await createUser("CUSTOMER", {
      name: "Request ID Customer",
      email: `request-id-${crypto.randomUUID()}@example.com`,
    });

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "Request ID Customer",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });

  it("should reject a refresh token", async () => {
    const support = await createUser("SUPPORT");

    const refreshToken = createRefreshToken(support.id);

    const response = await request(app)
      .get("/api/v1/support/customers")
      .query({
        q: "customer",
      })
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});