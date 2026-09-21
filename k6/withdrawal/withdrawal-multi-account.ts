import http from "k6/http";
import { check } from "k6";

const BASE_URL =
  __ENV.K6_BASE_URL || "http://localhost:5000";

const ACCESS_TOKEN =
  __ENV.K6_ACCESS_TOKEN;

const WITHDRAWAL_AMOUNT =
  __ENV.K6_WITHDRAWAL_AMOUNT || "10.00";

const ACCOUNTS = [
  __ENV.K6_ACCOUNT_1,
  __ENV.K6_ACCOUNT_2,
  __ENV.K6_ACCOUNT_3,
  __ENV.K6_ACCOUNT_4,
  __ENV.K6_ACCOUNT_5,
];

if (!ACCESS_TOKEN) {
  throw new Error(
    "K6_ACCESS_TOKEN environment variable is required",
  );
}

if (ACCOUNTS.some((account) => !account)) {
  throw new Error(
    "K6_ACCOUNT_1 through K6_ACCOUNT_5 are required",
  );
}

export const options = {
  vus: 5,
  duration: "30s",

  thresholds: {
    http_req_failed: [
      "rate==0",
    ],

    http_req_duration: [
      "p(95)<2000",
    ],

    checks: [
      "rate==1",
    ],
  },
};

export default function (): void {
  const accountIndex =
    (__VU - 1) % ACCOUNTS.length;

  const accountId =
    ACCOUNTS[accountIndex];

  const url =
    `${BASE_URL}/api/v1/accounts/` +
    `${accountId}/withdrawals`;

  const idempotencyKey =
    `k6-withdrawal-multi-${__VU}-${__ITER}-${Date.now()}`;

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
      test: "multi-account",
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

  if (response.status !== 200) {
    console.log(
      `Withdrawal failed: ` +
      `VU=${__VU}, ` +
      `account=${accountId}, ` +
      `status=${response.status}`,
    );

    console.log(
      `API response: ${response.body}`,
    );
  }
}