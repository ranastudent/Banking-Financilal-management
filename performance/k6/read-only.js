import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.K6_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = __ENV.K6_ACCESS_TOKEN || "";
const allowNonLocal = __ENV.K6_ALLOW_NON_LOCAL === "true";

if (!allowNonLocal && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
  throw new Error("Refusing to load-test a non-local host. Use isolated staging and explicitly set K6_ALLOW_NON_LOCAL=true.");
}
if (!token) {
  throw new Error("K6_ACCESS_TOKEN is required for authenticated read-only API load testing.");
}

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "1m", target: 10 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200", "p(99)<2500"],
  },
};

export default function () {
  const headers = { Authorization: `Bearer ${token}` };
  const history = http.get(`${baseUrl}/api/v1/transactions?limit=20`, {
    headers,
    tags: { name: "GET /api/v1/transactions" },
  });
  check(history, { "history returns 200": (r) => r.status === 200 });
  sleep(1);
}
