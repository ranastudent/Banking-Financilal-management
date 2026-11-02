import "../setup";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  getMetricEndpoint,
  metricsHandler,
  recordDatabaseError,
  recordDatabaseQuery,
  recordCacheOperation,
  recordRedisOperation,
  recordQueueFailure,
  recordRequest,
  recordTransferResult,
} from "../../observability/metrics";

const readMetrics = (): string => {
  let body = "";
  const response = {
    type(_contentType: string) {
      return this;
    },
    send(value: string) {
      body = value;
      return this;
    },
  } as unknown as Response;

  metricsHandler({} as Request, response);
  return body;
};

const readCounter = (metrics: string, name: string): number => {
  const line = metrics
    .split("\n")
    .find((entry) => entry.startsWith(`${name} `));

  if (!line) throw new Error(`Metric not found: ${name}`);
  return Number(line.slice(name.length + 1));
};

describe("Observability metrics", () => {
  it("exposes Prometheus text format and the expected metric names", () => {
    const metrics = readMetrics();

    expect(metrics).toContain("# TYPE banking_http_requests_total counter");
    expect(metrics).toContain("banking_http_requests_total ");
    expect(metrics).toContain("banking_http_errors_total ");
    expect(metrics).toContain("banking_http_latency_ms_average ");
    expect(metrics).toContain("banking_transfer_success_total ");
    expect(metrics).toContain("banking_transfer_failure_total ");
    expect(metrics).toContain("banking_queue_failures_total ");
    expect(metrics).toContain("banking_database_errors_total ");
    expect(metrics).toContain("banking_database_queries_total ");
    expect(metrics).toContain("banking_database_slow_queries_total ");
    expect(metrics).toContain("banking_redis_operations_total ");
    expect(metrics).toContain("banking_process_resident_memory_bytes ");
  });

  it("increments HTTP request and 5xx error counters and records route labels", () => {
    const before = readMetrics();
    const endpoint = "/__observability_test_route__";

    recordRequest({
      method: "GET",
      endpoint,
      status: 503,
      latencyMs: 12.5,
    });

    const after = readMetrics();

    expect(readCounter(after, "banking_http_requests_total")).toBe(
      readCounter(before, "banking_http_requests_total") + 1,
    );
    expect(readCounter(after, "banking_http_errors_total")).toBe(
      readCounter(before, "banking_http_errors_total") + 1,
    );
    expect(after).toContain(
      `banking_http_requests_by_route_total{method="GET",endpoint="${endpoint}",status="503"} 1`,
    );
  });

  it("increments transfer, queue, and database counters", () => {
    const before = readMetrics();

    recordTransferResult(true);
    recordTransferResult(false);
    recordQueueFailure();
    recordDatabaseError();

    const after = readMetrics();

    expect(readCounter(after, "banking_transfer_success_total")).toBe(
      readCounter(before, "banking_transfer_success_total") + 1,
    );
    expect(readCounter(after, "banking_transfer_failure_total")).toBe(
      readCounter(before, "banking_transfer_failure_total") + 1,
    );
    expect(readCounter(after, "banking_queue_failures_total")).toBe(
      readCounter(before, "banking_queue_failures_total") + 1,
    );
    expect(readCounter(after, "banking_database_errors_total")).toBe(
      readCounter(before, "banking_database_errors_total") + 1,
    );
  });


  it("records database query timings and slow-query counts", () => {
    const before = readMetrics();
    recordDatabaseQuery(25, false);
    recordDatabaseQuery(175, true);
    const after = readMetrics();

    expect(readCounter(after, "banking_database_queries_total")).toBe(
      readCounter(before, "banking_database_queries_total") + 2,
    );
    expect(readCounter(after, "banking_database_slow_queries_total")).toBe(
      readCounter(before, "banking_database_slow_queries_total") + 1,
    );
    expect(after).toContain("banking_database_query_duration_ms_average ");
    expect(after).toContain("banking_database_query_duration_ms_max ");
  });

  it("records Redis operation latency and failures", () => {
    const before = readMetrics();
    recordRedisOperation(4.5);
    recordRedisOperation(12, true);
    const after = readMetrics();

    expect(readCounter(after, "banking_redis_operations_total")).toBe(
      readCounter(before, "banking_redis_operations_total") + 2,
    );
    expect(readCounter(after, "banking_redis_operation_errors_total")).toBe(
      readCounter(before, "banking_redis_operation_errors_total") + 1,
    );
    expect(after).toContain("banking_redis_operation_duration_ms_average ");
  });

  it("uses Express route templates to avoid recording resource IDs as labels", () => {
    const req = {
      route: { path: "/accounts/:accountId" },
      baseUrl: "/api/v1",
      path: "/api/v1/accounts/123456",
    } as unknown as Request;

    expect(getMetricEndpoint(req)).toBe("/api/v1/accounts/:accountId");
  });

  it("normalizes numeric IDs when no Express route template is available", () => {
    const req = {
      path: "/api/v1/accounts/123456",
      baseUrl: "",
    } as unknown as Request;

    expect(getMetricEndpoint(req)).toBe("/api/v1/accounts/:id");
  });

  it("records cache hits, misses, writes, invalidations, and errors", () => {
    const before = readMetrics();
    recordCacheOperation("hit");
    recordCacheOperation("miss");
    recordCacheOperation("write");
    recordCacheOperation("invalidate");
    recordCacheOperation("error");
    const after = readMetrics();

    expect(readCounter(after, "banking_cache_hits_total")).toBe(
      readCounter(before, "banking_cache_hits_total") + 1,
    );
    expect(readCounter(after, "banking_cache_misses_total")).toBe(
      readCounter(before, "banking_cache_misses_total") + 1,
    );
    expect(readCounter(after, "banking_cache_writes_total")).toBe(
      readCounter(before, "banking_cache_writes_total") + 1,
    );
    expect(readCounter(after, "banking_cache_invalidations_total")).toBe(
      readCounter(before, "banking_cache_invalidations_total") + 1,
    );
    expect(readCounter(after, "banking_cache_errors_total")).toBe(
      readCounter(before, "banking_cache_errors_total") + 1,
    );
  });
});
