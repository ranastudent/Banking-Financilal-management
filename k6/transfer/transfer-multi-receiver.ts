import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { sleep } from "k6";

const BASE_URL =
  __ENV.K6_BASE_URL || "http://localhost:5000";

const ACCESS_TOKEN = __ENV.K6_ACCESS_TOKEN;

const SENDERS = (
  __ENV.K6_SENDER_ACCOUNTS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const RECEIVERS = (
  __ENV.K6_RECEIVER_ACCOUNTS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const AMOUNT =
  __ENV.K6_TRANSFER_AMOUNT || "1";

const CURRENCY =
  __ENV.K6_CURRENCY || "BDT";

const transferErrors = new Counter(
  "transfer_errors",
);

if (!ACCESS_TOKEN) {
  throw new Error(
    "K6_ACCESS_TOKEN environment variable is required",
  );
}

if (SENDERS.length === 0) {
  throw new Error(
    "K6_SENDER_ACCOUNTS is required",
  );
}

if (RECEIVERS.length === 0) {
  throw new Error(
    "K6_RECEIVER_ACCOUNTS is required",
  );
}

export const options = {
  vus: 5,

  duration: "10s",

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<5000"],
    checks: ["rate==1"],
  },
};

export default function () {
  const sender =
    SENDERS[(__VU - 1) % SENDERS.length];

  const receiver =
    RECEIVERS[(__VU - 1) % RECEIVERS.length];

  if (!sender || !receiver) {
    throw new Error(
      "Unable to resolve sender/receiver for current VU",
    );
  }

  console.log(
  `K6 INPUT | sender=${sender} | receiver=${receiver} | amount=${AMOUNT} | currency=${CURRENCY}`,
 );

  const payload = JSON.stringify({
    senderAccount: sender,
    receiverAccount: receiver,
    amount: AMOUNT,
    currency: CURRENCY,
  });

  const response = http.post(
    `${BASE_URL}/api/v1/transfers`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Idempotency-Key":
          `multi-receiver-${__VU}-${__ITER}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,
      },

      tags: {
        scenario: "multi_receiver",
      },
    },
  );

  const success = check(response, {
    "status is 200": (r) =>
      r.status === 200,

    "success is true": (r) =>
      r.json("success") === true,

    "transaction completed": (r) =>
      r.json(
        "data.transaction.status",
      ) === "COMPLETED",

    "internal transfer": (r) =>
      r.json(
        "data.transaction.type",
      ) === "INTERNAL_TRANSFER",

    "currency is correct": (r) =>
      r.json(
        "data.transaction.currencyCode",
      ) === CURRENCY,

    "requestId exists": (r) =>
      typeof r.json("requestId") === "string",
  });

  if (!success) {
  transferErrors.add(1);

  console.log(
    `TRANSFER FAILED | status=${response.status} | body=${response.body}`,
  );
}
}
sleep(1);