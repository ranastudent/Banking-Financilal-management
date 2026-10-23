export type AuditContext = {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
};

export type AuditEventInput = AuditContext & {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
  success?: boolean;
  failureReason?: string;
};
