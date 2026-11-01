export type MonitoringEventInput = {
  eventKey: string;
  eventType: string;
  transactionId?: string;
  accountId?: string;
  userId?: string;
  correlationId?: string;
  source?: string;
  occurredAt?: string | Date;
  payload: Record<string, unknown>;
};

export type DetectionResult = {
  detectionType: string;
  score: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  observedValue?: number;
  expectedValue?: number;
  explanation: string;
  evidence?: Record<string, unknown>;
  algorithmVersion: string;
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
