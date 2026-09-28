import { transferRequest, successfulTransferChecks } from "./_common.ts";

export const options = {
  vus: 1,
  iterations: 1,

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate==1"],
  },
};

export default function (): void {
  const response = transferRequest("smoke");
  successfulTransferChecks(response);

  if (response.status !== 200) {
    console.log(`Transfer smoke failed: status=${response.status}`);
    console.log(`API response: ${response.body}`);
  }
}
