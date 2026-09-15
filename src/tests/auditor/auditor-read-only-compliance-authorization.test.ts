import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { env } from "../../config/env";

const createAuditorAccessToken = () => {
  return jwt.sign(
    {
      sub: crypto.randomUUID(),
      email: `auditor-${crypto.randomUUID()}@example.com`,
      role: "AUDITOR",
      status: "ACTIVE",
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
};

describe("AUDITOR Read-Only Compliance Access", () => {
  const auditorToken = createAuditorAccessToken();

  describe("Read access", () => {
    it("should allow AUDITOR to access audit-log compliance data", async () => {
      const response = await request(app)
        .get("/api/v1/auditor/audit-logs?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should allow AUDITOR to access transaction compliance data", async () => {
      const response = await request(app)
        .get("/api/v1/auditor/transactions?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should allow AUDITOR to access approval compliance data", async () => {
      const response = await request(app)
        .get("/api/v1/auditor/approval-records?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should allow AUDITOR to access FX request compliance data", async () => {
      const response = await request(app)
        .get("/api/v1/auditor/fx-requests?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("Write protection", () => {
    it("should reject AUDITOR from creating an exchange rate", async () => {
      const response = await request(app)
        .post("/api/v1/admin/exchange-rates")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it("should reject AUDITOR from changing currency status", async () => {
      const response = await request(app)
        .patch("/api/v1/admin/currencies/USD/status")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({
          isActive: false,
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it("should reject AUDITOR from adjusting currency reserves", async () => {
      const response = await request(app)
        .post("/api/v1/admin/currency-reserves/USD/adjust")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({
          amount: 100,
          direction: "INCREASE",
          reason: "AUDITOR authorization regression test",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it("should reject AUDITOR from making an approval decision", async () => {
      const fakeRequestId = crypto.randomUUID();

      const response = await request(app)
        .post(
          `/api/v1/admin/approvals/fx-requests/${fakeRequestId}/decision`,
        )
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({
          decision: "APPROVED",
          comment: "AUDITOR authorization regression test",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    it("should reject AUDITOR from performing a transfer", async () => {
      const sourceAccountId = crypto.randomUUID();
      const destinationAccountId = crypto.randomUUID();

      const response = await request(app)
        .post(
          `/api/v1/transactions/transfer/${sourceAccountId}/${destinationAccountId}`,
        )
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({
          amount: 100,
          currencyCode: "USD",
          provider: "INTERNAL",
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe("Authentication boundary", () => {
    it("should reject unauthenticated compliance access", async () => {
      const response = await request(app).get(
        "/api/v1/auditor/audit-logs?page=1&limit=1",
      );

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it("should include requestId for authorized compliance access", async () => {
      const response = await request(app)
        .get("/api/v1/auditor/audit-logs?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.requestId).toBeDefined();
    });
  });
});