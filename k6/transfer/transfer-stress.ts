import { transferRequest, successfulTransferChecks } from "./_common.ts";

export const options = {
  summaryTimeUnit: "ms",

  thresholds: {
    // The performance environment should have the general
    // application rate limiter raised/disabled for this test.
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000"],
    checks: ["rate>0.95"],
  },

  scenarios: {
    transfer_stress: {
      executor: "ramping-vus",
      startVUs: 1,

      stages: [
        { duration: "20s", target: 1 },
        { duration: "30s", target: 10 },
        { duration: "30s", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "45s", target: 20 },
        { duration: "30s", target: 30 },
        { duration: "60s", target: 30 },
        { duration: "30s", target: 0 },
      ],

      gracefulRampDown: "15s",
    },
  },
};

export default function (): void {
  const response = transferRequest("stress");
  const passed = successfulTransferChecks(response);

  if (!passed) {
    console.log(`Transfer stress failed: status=${response.status}`);
    console.log(`API response: ${response.body}`);
  }
}
