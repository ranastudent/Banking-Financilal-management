import { transferRequest, successfulTransferChecks } from "./_common.ts";

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
  const response = transferRequest("normal-load");
  successfulTransferChecks(response);

  if (response.status !== 200) {
    console.log(`Transfer normal-load failed: status=${response.status}`);
    console.log(`API response: ${response.body}`);
  }
}
