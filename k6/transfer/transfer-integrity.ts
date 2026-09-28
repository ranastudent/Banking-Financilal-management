import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:5000";
const ACCESS_TOKEN = __ENV.K6_ACCESS_TOKEN;
const SENDER_ACCOUNT = __ENV.K6_SENDER_ACCOUNT;
const RECEIVER_ACCOUNT = __ENV.K6_RECEIVER_ACCOUNT;
const TRANSFER_AMOUNT = __ENV.K6_TRANSFER_AMOUNT || "1.00";
const CURRENCY = __ENV.K6_CURRENCY || "BDT";

if (!ACCESS_TOKEN) {
  throw new Error("K6_ACCESS_TOKEN environment variable is required");
}

if (!SENDER_ACCOUNT || !RECEIVER_ACCOUNT) {
  throw new Error(
    "K6_SENDER_ACCOUNT and K6_RECEIVER_ACCOUNT are required",
  );
}

export const options = {
  vus: 10,
  duration: "30s",

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<3000"],
    checks: ["rate==1"],
  },
};

export default function (): void {
  const response = http.post(
    `${BASE_URL}/api/v1/transfers`,
    JSON.stringify({
      senderAccount: SENDER_ACCOUNT,
      receiverAccount: RECEIVER_ACCOUNT,
      amount: TRANSFER_AMOUNT,
      currency: CURRENCY,
    }),
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key":
          `k6-transfer-integrity-${__VU}-${__ITER}-${Date.now()}-${Math.random()}`,
      },
      tags: {
        endpoint: "transfer",
        operation: "transfer",
        test: "financial-integrity",
      },
    },
  );

  check(response, {
    "status is 200": (res) => res.status === 200,
    "success is true": (res) => {
      try {
        return res.json("success") === true;
      } catch {
        return false;
      }
    },
    "transaction type is INTERNAL_TRANSFER": (res) => {
      try {
        return res.json("data.transaction.type") === "INTERNAL_TRANSFER";
      } catch {
        return false;
      }
    },
    "transaction status is COMPLETED": (res) => {
      try {
        return res.json("data.transaction.status") === "COMPLETED";
      } catch {
        return false;
      }
    },
    "transaction amount matches request": (res) => {
      try {
        const actualAmount = Number(
          res.json("data.transaction.amount"),
        );
        const expectedAmount = Number(TRANSFER_AMOUNT);

        return actualAmount === expectedAmount;
      } catch {
        return false;
      }
    },
    "currency matches request": (res) => {
      try {
        return res.json("data.transaction.currencyCode") === CURRENCY;
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

  if (response.status !== 200) {
    console.log(
      `Transfer integrity test failed: status=${response.status}`,
    );
    console.log(`API response: ${response.body}`);
  }
}
