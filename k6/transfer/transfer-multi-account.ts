import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:5000";
const ACCESS_TOKEN = __ENV.K6_ACCESS_TOKEN;
const RECEIVER_ACCOUNT = __ENV.K6_RECEIVER_ACCOUNT;
const TRANSFER_AMOUNT = __ENV.K6_TRANSFER_AMOUNT || "1.00";
const CURRENCY = __ENV.K6_CURRENCY || "BDT";

const SENDERS = [
  __ENV.K6_SENDER_ACCOUNT_1,
  __ENV.K6_SENDER_ACCOUNT_2,
  __ENV.K6_SENDER_ACCOUNT_3,
  __ENV.K6_SENDER_ACCOUNT_4,
  __ENV.K6_SENDER_ACCOUNT_5,
];

if (!ACCESS_TOKEN) {
  throw new Error("K6_ACCESS_TOKEN environment variable is required");
}

if (!RECEIVER_ACCOUNT) {
  throw new Error("K6_RECEIVER_ACCOUNT environment variable is required");
}

if (SENDERS.some((account) => !account)) {
  throw new Error(
    "K6_SENDER_ACCOUNT_1 through K6_SENDER_ACCOUNT_5 are required",
  );
}

export const options = {
  vus: 5,
  duration: "15s",

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate==1"],
  },
};

export default function (): void {
  const senderAccount = SENDERS[(__VU - 1) % SENDERS.length];

  const response = http.post(
    `${BASE_URL}/api/v1/transfers`,
    JSON.stringify({
      senderAccount,
      receiverAccount: RECEIVER_ACCOUNT,
      amount: TRANSFER_AMOUNT,
      currency: CURRENCY,
    }),
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key":
          `k6-transfer-multi-${__VU}-${__ITER}-${Date.now()}-${Math.random()}`,
      },
      tags: {
        endpoint: "transfer",
        operation: "transfer",
        test: "multi-account",
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
      `Transfer multi-account failed: VU=${__VU}, sender=${senderAccount}, status=${response.status}`,
    );
    console.log(`API response: ${response.body}`);
  }
}
