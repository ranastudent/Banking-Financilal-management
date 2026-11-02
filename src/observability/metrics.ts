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
let maxRequestLatencyMs = 0;
let transferSuccesses = 0;
let transferFailures = 0;
let queueFailures = 0;
let databaseErrors = 0;
let databaseQueries = 0;
let databaseQueryErrors = 0;
let databaseSlowQueries = 0;
let databaseQueryTotalMs = 0;
let databaseQueryMaxMs = 0;
let redisOperations = 0;
let redisOperationErrors = 0;
let redisOperationTotalMs = 0;
let redisOperationMaxMs = 0;
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
  maxRequestLatencyMs = Math.max(maxRequestLatencyMs, input.latencyMs);
};


/** Record Prisma query-event timing without retaining SQL or parameter values. */
export const recordDatabaseQuery = (durationMs: number, slow: boolean): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  databaseQueries += 1;
  databaseQueryTotalMs += durationMs;
  databaseQueryMaxMs = Math.max(databaseQueryMaxMs, durationMs);
  if (slow) databaseSlowQueries += 1;
};

export const recordRedisOperation = (durationMs: number, failed = false): void => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  redisOperations += 1;
  redisOperationTotalMs += durationMs;
  redisOperationMaxMs = Math.max(redisOperationMaxMs, durationMs);
  if (failed) redisOperationErrors += 1;
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

    "# HELP banking_http_latency_ms_max Maximum observed HTTP request latency in milliseconds.",
    "# TYPE banking_http_latency_ms_max gauge",
    `banking_http_latency_ms_max ${maxRequestLatencyMs}`,

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

    "# HELP banking_database_queries_total Prisma query events observed.",
    "# TYPE banking_database_queries_total counter",
    `banking_database_queries_total ${databaseQueries}`,
    "# HELP banking_database_slow_queries_total Prisma queries at or above the configured slow threshold.",
    "# TYPE banking_database_slow_queries_total counter",
    `banking_database_slow_queries_total ${databaseSlowQueries}`,
    "# HELP banking_database_query_duration_ms_average Average observed Prisma query duration in milliseconds.",
    "# TYPE banking_database_query_duration_ms_average gauge",
    `banking_database_query_duration_ms_average ${databaseQueries ? databaseQueryTotalMs / databaseQueries : 0}`,
    "# HELP banking_database_query_duration_ms_max Maximum observed Prisma query duration in milliseconds.",
    "# TYPE banking_database_query_duration_ms_max gauge",
    `banking_database_query_duration_ms_max ${databaseQueryMaxMs}`,
    "# HELP banking_redis_operations_total Redis operations measured by application instrumentation.",
    "# TYPE banking_redis_operations_total counter",
    `banking_redis_operations_total ${redisOperations}`,
    "# HELP banking_redis_operation_errors_total Failed Redis operations measured by application instrumentation.",
    "# TYPE banking_redis_operation_errors_total counter",
    `banking_redis_operation_errors_total ${redisOperationErrors}`,
    "# HELP banking_redis_operation_duration_ms_average Average measured Redis operation duration in milliseconds.",
    "# TYPE banking_redis_operation_duration_ms_average gauge",
    `banking_redis_operation_duration_ms_average ${redisOperations ? redisOperationTotalMs / redisOperations : 0}`,
    "# HELP banking_redis_operation_duration_ms_max Maximum measured Redis operation duration in milliseconds.",
    "# TYPE banking_redis_operation_duration_ms_max gauge",
    `banking_redis_operation_duration_ms_max ${redisOperationMaxMs}`,
    "# HELP banking_process_uptime_seconds Process uptime in seconds.",
    "# TYPE banking_process_uptime_seconds gauge",
    `banking_process_uptime_seconds ${process.uptime()}`,
    "# HELP banking_process_resident_memory_bytes Resident memory in bytes.",
    "# TYPE banking_process_resident_memory_bytes gauge",
    `banking_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    "# HELP banking_process_heap_used_bytes JavaScript heap used in bytes.",
    "# TYPE banking_process_heap_used_bytes gauge",
    `banking_process_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    "# HELP banking_process_cpu_user_seconds_total Process user CPU time in seconds.",
    "# TYPE banking_process_cpu_user_seconds_total counter",
    `banking_process_cpu_user_seconds_total ${process.cpuUsage().user / 1_000_000}`,
    "# HELP banking_process_cpu_system_seconds_total Process system CPU time in seconds.",
    "# TYPE banking_process_cpu_system_seconds_total counter",
    `banking_process_cpu_system_seconds_total ${process.cpuUsage().system / 1_000_000}`,

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