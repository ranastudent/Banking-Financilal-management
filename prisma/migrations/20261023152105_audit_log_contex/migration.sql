/*
  Warnings:

  - The values [TRANSFER_SUCCESS,TRANSFER_FAILED,DEPOSIT_SUCCESS,WITHDRAWAL_SUCCESS,ACCOUNT_BLOCKED,SECURITY_ALERT] on the enum `NotificationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('REGISTRATION_OTP', 'EMAIL_VERIFICATION', 'TRANSACTION', 'FX_REQUEST', 'FX_APPROVAL', 'SECURITY', 'SYSTEM');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;
