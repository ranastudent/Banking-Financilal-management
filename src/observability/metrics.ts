import type { Request, Response } from "express";

interface RequestMetric {
  count: number;
  errors: number;
  totalLatencyMs: number;
}

const requestMetrics = new Map<string, RequestMetric>();

let totalRequests = 0;
let totalErrors = 0;
let totalLatencyMs = 0;
let transferSuccesses = 0;
let transferFailures = 0;
let queueFailures = 0;
let databaseErrors = 0;
let riskAssessments = 0;
let riskHolds = 0;
let riskApprovals = 0;
let riskRejections = 0;

const labelValue = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');

/**
 * Prefer Express's route template to avoid unbounded labels from resource IDs.
 */
export const getMetricEndpoint = (req: Request): string => {
  const routePath = req.route?.path;
  const baseUrl = req.baseUrl ?? "";

  if (typeof routePath === "string") {
    return `${baseUrl}${routePath}` || "/";
  }

  if (Array.isArray(routePath)) {
    return `${baseUrl}${routePath.join("|")}` || "/";
  }

  return (req.path || "/")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\b\d{3,}\b/g, ":id");
};

export const recordRequest = (input: {
  method: string;
  endpoint: string;
  status: number;
  latencyMs: number;
}): void => {
  const key = `${input.method}|${input.endpoint}|${input.status}`;

  const current = requestMetrics.get(key) ?? {
    count: 0,
    errors: 0,
    totalLatencyMs: 0,
  };

  current.count += 1;
  current.errors += input.status >= 500 ? 1 : 0;
  current.totalLatencyMs += input.latencyMs;

  requestMetrics.set(key, current);

  totalRequests += 1;
  totalErrors += input.status >= 500 ? 1 : 0;
  totalLatencyMs += input.latencyMs;
};

export const recordTransferResult = (success: boolean): void => {
  if (success) {
    transferSuccesses += 1;
  } else {
    transferFailures += 1;
  }
};

export const recordQueueFailure = (): void => {
  queueFailures += 1;
};

export const recordDatabaseError = (): void => {
  databaseErrors += 1;
};

export const recordRiskAssessment = (decision: "APPROVE" | "HOLD"): void => {
  riskAssessments += 1;
  if (decision === "HOLD") riskHolds += 1;
};

export const recordRiskReview = (decision: "APPROVED" | "REJECTED"): void => {
  if (decision === "APPROVED") riskApprovals += 1;
  else riskRejections += 1;
};

export const metricsHandler = (
  _req: Request,
  res: Response,
): void => {
  const lines: string[] = [
    "# HELP banking_http_requests_total Total HTTP requests observed.",
    "# TYPE banking_http_requests_total counter",
    `banking_http_requests_total ${totalRequests}`,

    "# HELP banking_http_errors_total HTTP 5xx responses observed.",
    "# TYPE banking_http_errors_total counter",
    `banking_http_errors_total ${totalErrors}`,

    "# HELP banking_http_error_rate HTTP 5xx responses divided by all observed requests.",
    "# TYPE banking_http_error_rate gauge",
    `banking_http_error_rate ${
      totalRequests ? totalErrors / totalRequests : 0
    }`,

    "# HELP banking_http_latency_ms_average Average HTTP request latency in milliseconds.",
    "# TYPE banking_http_latency_ms_average gauge",
    `banking_http_latency_ms_average ${
      totalRequests ? totalLatencyMs / totalRequests : 0
    }`,

    "# HELP banking_transfer_success_total Successful fund transfers observed.",
    "# TYPE banking_transfer_success_total counter",
    `banking_transfer_success_total ${transferSuccesses}`,

    "# HELP banking_transfer_failure_total Failed fund transfer attempts observed.",
    "# TYPE banking_transfer_failure_total counter",
    `banking_transfer_failure_total ${transferFailures}`,

    "# HELP banking_transfer_success_rate Transfer successes divided by all observed transfer attempts.",
    "# TYPE banking_transfer_success_rate gauge",
    `banking_transfer_success_rate ${
      transferSuccesses + transferFailures
        ? transferSuccesses / (transferSuccesses + transferFailures)
        : 0
    }`,

    "# HELP banking_queue_failures_total Background queue jobs that failed.",
    "# TYPE banking_queue_failures_total counter",
    `banking_queue_failures_total ${queueFailures}`,

    "# HELP banking_risk_assessments_total Transfer risk assessments observed.",
    "# TYPE banking_risk_assessments_total counter",
    `banking_risk_assessments_total ${riskAssessments}`,
    "# HELP banking_risk_holds_total Transfers placed on risk hold.",
    "# TYPE banking_risk_holds_total counter",
    `banking_risk_holds_total ${riskHolds}`,
    "# HELP banking_risk_reviews_approved_total Risk holds approved by administrators.",
    "# TYPE banking_risk_reviews_approved_total counter",
    `banking_risk_reviews_approved_total ${riskApprovals}`,
    "# HELP banking_risk_reviews_rejected_total Risk holds rejected by administrators.",
    "# TYPE banking_risk_reviews_rejected_total counter",
    `banking_risk_reviews_rejected_total ${riskRejections}`,

    "# HELP banking_database_errors_total Database-related errors observed.",
    "# TYPE banking_database_errors_total counter",
    `banking_database_errors_total ${databaseErrors}`,

    "# HELP banking_http_requests_by_route_total HTTP requests by method, endpoint template, and status.",
    "# TYPE banking_http_requests_by_route_total counter",
  ];

  for (const [key, metric] of requestMetrics) {
    // Default values prevent string | undefined TypeScript errors.
    const [
      method = "UNKNOWN",
      endpoint = "/",
      status = "0",
    ] = key.split("|");

    const labels =
      `method="${labelValue(method)}",` +
      `endpoint="${labelValue(endpoint)}",` +
      `status="${labelValue(status)}"`;

    lines.push(
      `banking_http_requests_by_route_total{${labels}} ${metric.count}`,
    );
  }

  res
    .type("text/plain; version=0.0.4; charset=utf-8")
    .send(`${lines.join("\n")}\n`);
};