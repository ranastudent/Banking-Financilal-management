import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL =
  __ENV.K6_BASE_URL || "http://localhost:5000";

const ACCESS_TOKEN =
  __ENV.K6_ACCESS_TOKEN;

const ACCOUNT_ID =
  __ENV.K6_ACCOUNT_ID;

const DEPOSIT_AMOUNT =
  __ENV.K6_DEPOSIT_AMOUNT || "1.00";

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

const depositDuration =
  new Trend("deposit_duration");

export const options = {
  vus: 1,
  duration: "30s",

  thresholds: {
    http_req_failed: [
      "rate<0.01",
    ],

    checks: [
      "rate>0.99",
    ],

    http_req_duration: [
      "p(95)<5000",
    ],
  },
};

export default function (): void {
  const response = http.post(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/deposits`,
    JSON.stringify({
      amount: DEPOSIT_AMOUNT,
      currency: "BDT",
    }),
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key":
          `k6-baseline-${__VU}-${__ITER}-${Date.now()}`,
      },
      tags: {
        endpoint: "deposit",
        operation: "deposit",
        test: "baseline",
      },
    },
  );

  depositDuration.add(
    response.timings.duration,
  );

  check(response, {
    "status is 200": (res) =>
      res.status === 200,

    "success is true": (res) => {
      try {
        return (
          res.json("success") === true
        );
      } catch {
        return false;
      }
    },

    "transaction type is DEPOSIT": (res) => {
      try {
        return (
          res.json(
            "data.transaction.type",
          ) === "DEPOSIT"
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
  });
}