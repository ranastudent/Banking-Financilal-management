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
  __ENV.K6_DEPOSIT_AMOUNT || "0.01";

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
      "rate<0.05",
    ],

    checks: [
      "rate>0.95",
    ],
  },

  scenarios: {
    deposit_stress: {
      executor: "ramping-vus",

      startVUs: 1,

      stages: [
        // Warm-up
        {
          duration: "20s",
          target: 1,
        },

        // Ramp to 10 VUs
        {
          duration: "30s",
          target: 10,
        },

        // Hold 10 VUs
        {
          duration: "30s",
          target: 10,
        },

        // Ramp to 20 VUs
        {
          duration: "30s",
          target: 20,
        },

        // Hold 20 VUs
        {
          duration: "45s",
          target: 20,
        },

        // Ramp to 30 VUs
        {
          duration: "30s",
          target: 30,
        },

        // Hold 30 VUs
        {
          duration: "60s",
          target: 30,
        },

        // Ramp down
        {
          duration: "30s",
          target: 0,
        },
      ],

      gracefulRampDown: "15s",
    },
  },
};

export default function (): void {
  const url =
    `${BASE_URL}/api/v1/accounts/` +
    `${ACCOUNT_ID}/deposits`;

  const idempotencyKey =
    `k6-stress-${__VU}-${__ITER}-${Date.now()}`;

  const payload = JSON.stringify({
    amount: DEPOSIT_AMOUNT,
    currency: "BDT",
  });

  const response = http.post(
    url,
    payload,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },

      tags: {
        endpoint: "deposit",
        operation: "deposit",
        test: "stress",
      },
    },
  );

  depositDuration.add(
    response.timings.duration,
  );

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

  if (!passed) {
    console.log(
      `Stress deposit failed: status=${response.status}`,
    );

    console.log(
      `API response: ${response.body}`,
    );
  }
}