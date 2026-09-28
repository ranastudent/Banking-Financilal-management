import { transferRequest, successfulTransferChecks } from "./_common.ts";

export const options = {
  vus: 1,
  iterations: 20,

  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate==1"],
  },
};

export default function (): void {
  const response = transferRequest("baseline");
  successfulTransferChecks(response);

  if (response.status !== 200) {
    console.log(`Transfer baseline failed: status=${response.status}`);
    console.log(`API response: ${response.body}`);
  }
}
