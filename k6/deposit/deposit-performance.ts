import http from "k6/http";
import { check, sleep } from "k6";
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
  summaryTimeUnit: "ms",

  thresholds: {
    http_req_failed: [
      "rate<0.01",
    ],

    http_req_duration: [
      "p(95)<2000",
      "p(99)<4000",
    ],

    deposit_duration: [
      "p(95)<2000",
    ],

    checks: [
      "rate>0.99",
    ],
  },

  scenarios: {
    deposit_load: {
      executor: "ramping-vus",

      startVUs: 1,

      stages: [
        {
          duration: "10s",
          target: 1,
        },
        {
          duration: "20s",
          target: 5,
        },
        {
          duration: "30s",
          target: 5,
        },
        {
          duration: "20s",
          target: 10,
        },
        {
          duration: "30s",
          target: 10,
        },
        {
          duration: "10s",
          target: 0,
        },
      ],

      gracefulRampDown: "10s",
    },
  },
};

export default function (): void {
  const url =
    `${BASE_URL}/api/v1/accounts/` +
    `${ACCOUNT_ID}/deposits`;

  const idempotencyKey =
    `k6-${__VU}-${__ITER}-${Date.now()}`;

  const payload = JSON.stringify({
    amount: DEPOSIT_AMOUNT,
    currency: "BDT",
  });

  const params = {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },

    tags: {
      endpoint: "deposit",
      operation: "deposit",
    },
  };

  const start = Date.now();

  const response = http.post(
    url,
    payload,
    params,
  );

  const duration = Date.now() - start;

  depositDuration.add(duration);

  const passed = check(response, {
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

    "transaction is DEPOSIT": (res) => {
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

  if (!passed) {
    console.log(
      `Deposit failed: status=${response.status}`,
    );
  }

  sleep(0.2);
}