-- Phase 24: add explicit in-app notification types.
-- Apply after updating the active Prisma schema and regenerating Prisma Client.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRANSFER_SUCCESS';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRANSFER_FAILED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEPOSIT_SUCCESS';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_SUCCESS';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SECURITY_ALERT';
