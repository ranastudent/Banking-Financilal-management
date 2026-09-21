import http from "k6/http";
import { check } from "k6";

const BASE_URL =
  __ENV.K6_BASE_URL || "http://localhost:5000";

const ACCESS_TOKEN =
  __ENV.K6_ACCESS_TOKEN;

const ACCOUNT_ID =
  __ENV.K6_ACCOUNT_ID;

const WITHDRAWAL_AMOUNT =
  __ENV.K6_WITHDRAWAL_AMOUNT || "10.00";

if (!ACCESS_TOKEN) {
  throw new Error(
    "K6_ACCESS_TOKEN environment variable is required",
  );
}

if (!ACCOUNT_ID) {
  throw new Error(
    "K6_ACCOUNT_ID environment variable is required",
  );
}

export const options = {
  vus: 10,
  duration: "30s",

  thresholds: {
    http_req_failed: [
      "rate==0",
    ],

    checks: [
      "rate==1",
    ],
  },
};

export default function (): void {
  const url =
    `${BASE_URL}/api/v1/accounts/` +
    `${ACCOUNT_ID}/withdrawals`;

  const idempotencyKey =
    `k6-integrity-${__VU}-${__ITER}-${Date.now()}`;

  const payload = JSON.stringify({
    amount: WITHDRAWAL_AMOUNT,
    currency: "BDT",
  });

  const params = {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },

    tags: {
      endpoint: "withdrawal",
      operation: "withdrawal",
      test: "financial-integrity",
    },
  };

  const response = http.post(
    url,
    payload,
    params,
  );

  check(response, {
    "status is 200": (res) =>
      res.status === 200,

    "success is true": (res) => {
      try {
        return res.json("success") === true;
      } catch {
        return false;
      }
    },

    "transaction type is WITHDRAWAL": (res) => {
      try {
        return (
          res.json(
            "data.transaction.type",
          ) === "WITHDRAWAL"
        );
      } catch {
        return false;
      }
    },

    "currency is BDT": (res) => {
      try {
        return (
          res.json(
            "data.currency",
          ) === "BDT"
        );
      } catch {
        return false;
      }
    },

    "requestId exists": (res) => {
      try {
        return Boolean(
          res.json("requestId"),
        );
      } catch {
        return false;
      }
    },

    "amount matches normalized request": (res) => {
      try {
        const responseAmount = String(
          res.json("data.amount"),
        );

        const expectedAmount = String(
          Number(WITHDRAWAL_AMOUNT),
        );

        return (
          responseAmount === expectedAmount
        );
      } catch {
        return false;
      }
    },
  });
}