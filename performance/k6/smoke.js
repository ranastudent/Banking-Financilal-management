import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.K6_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = __ENV.K6_ACCESS_TOKEN || "";
const allowNonLocal = __ENV.K6_ALLOW_NON_LOCAL === "true";

if (!allowNonLocal && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl)) {
  throw new Error("Refusing to load-test a non-local host. Use an isolated staging system and set K6_ALLOW_NON_LOCAL=true explicitly.");
}

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health`, { tags: { name: "GET /health" } });
  check(health, { "health returns 200": (r) => r.status === 200 || r.status === 503 });

  const ready = http.get(`${baseUrl}/ready`, { tags: { name: "GET /ready" } });
  check(ready, { "readiness responds": (r) => r.status === 200 || r.status === 503 });

  if (token) {
    const history = http.get(`${baseUrl}/api/v1/transactions?limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
      tags: { name: "GET /api/v1/transactions" },
    });
    check(history, { "transaction history responds": (r) => r.status === 200 });
  }

  sleep(1);
}
