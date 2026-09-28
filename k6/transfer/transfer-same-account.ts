import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:5000";
const ACCESS_TOKEN = __ENV.K6_ACCESS_TOKEN;
const ACCOUNT = __ENV.K6_SENDER_ACCOUNT || __ENV.K6_ACCOUNT_ID;

if (!ACCESS_TOKEN) {
  throw new Error("K6_ACCESS_TOKEN environment variable is required");
}

if (!ACCOUNT) {
  throw new Error(
    "K6_SENDER_ACCOUNT or K6_ACCOUNT_ID environment variable is required",
  );
}

export const options = {
  vus: 10,
  duration: "15s",

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate==1"],
  },
};

export default function (): void {
  const response = http.post(
    `${BASE_URL}/api/v1/transfers`,
    JSON.stringify({
      senderAccount: ACCOUNT,
      receiverAccount: ACCOUNT,
      amount: __ENV.K6_TRANSFER_AMOUNT || "1.00",
      currency: __ENV.K6_CURRENCY || "BDT",
    }),
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key":
          `k6-transfer-same-account-${__VU}-${__ITER}-${Date.now()}-${Math.random()}`,
      },
      tags: {
        endpoint: "transfer",
        operation: "transfer",
        test: "same-account",
      },
    },
  );

  check(response, {
    "status is 400": (res) => res.status === 400,

    "success is false": (res) => {
      try {
        return res.json("success") === false;
      } catch {
        return false;
      }
    },

    "error code is BAD_REQUEST": (res) => {
      try {
        return res.json("error.code") === "BAD_REQUEST";
      } catch {
        return false;
      }
    },

    "requestId exists": (res) => {
      try {
        return Boolean(res.json("requestId"));
      } catch {
        return false;
      }
    },
  });

  if (response.status !== 400) {
    console.log(
      `Same-account transfer returned unexpected status=${response.status}`,
    );
    console.log(`API response: ${response.body}`);
  }
}
