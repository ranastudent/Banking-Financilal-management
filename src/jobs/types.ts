export type TransferCommittedPayload = {
  outboxEventId: string;
  transactionId: string;
  actorUserId: string;
  /** Set only on recipient-specific email jobs created by the email dispatcher. */
  recipientUserId?: string;
};

export type NotificationType =
  | "TRANSFER_SUCCESS"
  | "TRANSFER_FAILED"
  | "DEPOSIT_SUCCESS"
  | "WITHDRAWAL_SUCCESS"
  | "ACCOUNT_BLOCKED"
  | "SECURITY_ALERT";

export type NotificationEventPayload = {
  outboxEventId: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ReportJobPayload = {
  trigger: "scheduled" | "manual";
  periodStart?: string;
  periodEnd?: string;
};

export type BackgroundJobData =
  | TransferCommittedPayload
  | NotificationEventPayload
  | ReportJobPayload;

export type BackgroundJobName =
  | "send-email"
  | "send-notification"
  | "send-notification-event"
  | "process-audit-event"
  | "risk-analysis"
  | "generate-report";

export const isTransferCommittedPayload = (
  value: BackgroundJobData,
): value is TransferCommittedPayload =>
  "outboxEventId" in value &&
  "transactionId" in value &&
  "actorUserId" in value;

const notificationTypes: readonly NotificationType[] = [
  "TRANSFER_SUCCESS",
  "TRANSFER_FAILED",
  "DEPOSIT_SUCCESS",
  "WITHDRAWAL_SUCCESS",
  "ACCOUNT_BLOCKED",
  "SECURITY_ALERT",
];

export const isNotificationEventPayload = (
  value: unknown,
): value is NotificationEventPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NotificationEventPayload>;
  return (
    typeof candidate.outboxEventId === "string" &&
    candidate.outboxEventId.length > 0 &&
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    typeof candidate.notificationType === "string" &&
    notificationTypes.includes(candidate.notificationType as NotificationType) &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string"
  );
};
