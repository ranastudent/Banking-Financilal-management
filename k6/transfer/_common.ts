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

if (!SENDER_ACCOUNT) {
  throw new Error("K6_SENDER_ACCOUNT environment variable is required");
}

if (!RECEIVER_ACCOUNT) {
  throw new Error("K6_RECEIVER_ACCOUNT environment variable is required");
}

export function transferRequest(tag: string) {
  const url = `${BASE_URL}/api/v1/transfers`;

  const idempotencyKey =
    `k6-transfer-${tag}-${__VU}-${__ITER}-${Date.now()}-${Math.random()}`;

  const payload = JSON.stringify({
    senderAccount: SENDER_ACCOUNT,
    receiverAccount: RECEIVER_ACCOUNT,
    amount: TRANSFER_AMOUNT,
    currency: CURRENCY,
  });

  return http.post(url, payload, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    tags: {
      endpoint: "transfer",
      operation: "transfer",
      test: tag,
    },
  });
}

export function successfulTransferChecks(response: http.Response) {
  return check(response, {
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
        return (
          res.json("data.transaction.type") ===
          "INTERNAL_TRANSFER"
        );
      } catch {
        return false;
      }
    },

    "transaction status is COMPLETED": (res) => {
      try {
        return (
          res.json("data.transaction.status") ===
          "COMPLETED"
        );
      } catch {
        return false;
      }
    },

    "currency is correct": (res) => {
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
}
