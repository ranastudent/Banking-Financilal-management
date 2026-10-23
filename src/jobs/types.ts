export type TransferCommittedPayload = {
  outboxEventId: string;
  transactionId: string;
  actorUserId: string;
  /** Set only on recipient-specific email jobs created by the email dispatcher. */
  recipientUserId?: string;
};

export type ReportJobPayload = {
  trigger: "scheduled" | "manual";
  periodStart?: string;
  periodEnd?: string;
};

export type BackgroundJobData =
  | TransferCommittedPayload
  | ReportJobPayload;

export type BackgroundJobName =
  | "send-email"
  | "send-notification"
  | "process-audit-event"
  | "risk-analysis"
  | "generate-report";

export const isTransferCommittedPayload = (
  value: BackgroundJobData,
): value is TransferCommittedPayload =>
  "outboxEventId" in value &&
  "transactionId" in value &&
  "actorUserId" in value;
